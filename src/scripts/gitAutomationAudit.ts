/**
 * gitAutomationAudit.ts — Verifica se commit e push possono essere automatizzati in modo sicuro
 *
 * Obiettivo:
 * - tradurre la policy commit/push in un controllo eseguibile
 * - distinguere tra READY / REVIEW / BLOCKED / NOOP
 * - dare un verdetto deterministicamente riusabile anche da hook o workflow futuri
 *
 * Uso:
 *   npx ts-node src/scripts/gitAutomationAudit.ts
 *   npm run audit:git-automation
 *   npm run audit:git-automation -- --json
 *   npm run audit:git-automation -- --strict=commit
 *   npm run audit:git-automation -- --strict=push
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { basename, join, resolve } from 'path';

type DecisionStatus = 'ready' | 'review' | 'blocked' | 'noop';
type StrictTarget = 'commit' | 'push' | null;

interface ChangedFile {
    path: string;
    staged: boolean;
    unstaged: boolean;
    untracked: boolean;
    code: string;
}

interface Decision {
    status: DecisionStatus;
    reasons: string[];
    nextSteps: string[];
}

interface RepoState {
    rootDir: string;
    gitDir: string;
    branch: string | null;
    upstream: string | null;
    originUrl: string | null;
    ahead: number;
    behind: number;
    changedFiles: ChangedFile[];
    stagedCount: number;
    unstagedCount: number;
    untrackedCount: number;
    topLevelAreas: string[];
    riskyFiles: string[];
    gitOperationsInProgress: string[];
}

interface AuditReport {
    generatedAt: string;
    repo: {
        rootDir: string;
        gitDir: string;
        branch: string | null;
        upstream: string | null;
        originUrl: string | null;
        ahead: number;
        behind: number;
    };
    workingTree: {
        changedFiles: number;
        stagedCount: number;
        unstagedCount: number;
        untrackedCount: number;
        topLevelAreas: string[];
        riskyFiles: string[];
        gitOperationsInProgress: string[];
    };
    decisions: {
        commit: Decision;
        push: Decision;
    };
}

function runGit(args: string[], allowFailure = false): string | null {
    try {
        return execFileSync('git', args, {
            cwd: process.cwd(),
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
    } catch (error) {
        if (allowFailure) {
            return null;
        }
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`git ${args.join(' ')} fallito: ${detail}`);
    }
}

function uniqueSorted(values: string[]): string[] {
    return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function normalizeChangedPath(rawPath: string): string {
    const target = rawPath.includes(' -> ') ? (rawPath.split(' -> ').pop() ?? rawPath) : rawPath;
    return target.trim().replace(/^"+|"+$/g, '').replace(/\\/g, '/');
}

function parseChangedFiles(): ChangedFile[] {
    const status = runGit(['status', '--porcelain=v1', '--untracked-files=all']);
    if (!status) {
        return [];
    }

    return status
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0)
        .filter((line) => !line.startsWith('##'))
        .map((line) => {
            const code = line.slice(0, 2);
            const path = normalizeChangedPath(line.slice(3));
            const staged = code[0] !== ' ' && code[0] !== '?';
            const unstaged = code[1] !== ' ' && code[1] !== '?';
            const untracked = code === '??';

            return {
                path,
                staged,
                unstaged,
                untracked,
                code,
            };
        });
}

function getTopLevelArea(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    return parts.length <= 1 ? '(root)' : parts[0];
}

function detectRiskyFiles(paths: string[]): string[] {
    const blockers = paths.filter((path) => {
        const name = basename(path).toLowerCase();
        return (
            name === '.env' ||
            name.startsWith('.env.') ||
            name.endsWith('.pem') ||
            name.endsWith('.key') ||
            name.endsWith('.p12') ||
            name.endsWith('.pfx') ||
            name === 'id_rsa' ||
            name === 'id_dsa' ||
            name === 'id_ed25519'
        );
    });

    return uniqueSorted(blockers);
}

function detectGitOperationsInProgress(gitDir: string): string[] {
    const markers = [
        { name: 'merge', path: join(gitDir, 'MERGE_HEAD') },
        { name: 'rebase-merge', path: join(gitDir, 'rebase-merge') },
        { name: 'rebase-apply', path: join(gitDir, 'rebase-apply') },
        { name: 'cherry-pick', path: join(gitDir, 'CHERRY_PICK_HEAD') },
        { name: 'revert', path: join(gitDir, 'REVERT_HEAD') },
        { name: 'bisect', path: join(gitDir, 'BISECT_LOG') },
    ];

    return markers.filter((marker) => existsSync(marker.path)).map((marker) => marker.name);
}

function readRepoState(): RepoState {
    const insideWorkTree = runGit(['rev-parse', '--is-inside-work-tree']);
    if (insideWorkTree !== 'true') {
        throw new Error('La cartella corrente non e\' un repository git valido.');
    }

    const rootDir = runGit(['rev-parse', '--show-toplevel']);
    const gitDirRaw = runGit(['rev-parse', '--git-dir']);
    if (!rootDir || !gitDirRaw) {
        throw new Error('Impossibile determinare rootDir o gitDir del repository.');
    }

    const gitDir = resolve(rootDir, gitDirRaw);
    const branchRaw = runGit(['branch', '--show-current'], true);
    const branch = branchRaw && branchRaw.length > 0 ? branchRaw : null;
    const upstream = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], true);
    const originUrl = runGit(['remote', 'get-url', 'origin'], true);

    let ahead = 0;
    let behind = 0;
    if (upstream) {
        const divergence = runGit(['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
        if (!divergence) {
            throw new Error('Impossibile calcolare ahead/behind rispetto all\'upstream.');
        }
        const [behindRaw, aheadRaw] = divergence.split(/\s+/);
        behind = Number.parseInt(behindRaw ?? '0', 10);
        ahead = Number.parseInt(aheadRaw ?? '0', 10);
    }

    const changedFiles = parseChangedFiles();
    const stagedCount = changedFiles.filter((file) => file.staged).length;
    const unstagedCount = changedFiles.filter((file) => file.unstaged).length;
    const untrackedCount = changedFiles.filter((file) => file.untracked).length;
    const topLevelAreas = uniqueSorted(changedFiles.map((file) => getTopLevelArea(file.path)));
    const riskyFiles = detectRiskyFiles(changedFiles.map((file) => file.path));
    const gitOperationsInProgress = detectGitOperationsInProgress(gitDir);

    return {
        rootDir,
        gitDir,
        branch,
        upstream,
        originUrl,
        ahead,
        behind,
        changedFiles,
        stagedCount,
        unstagedCount,
        untrackedCount,
        topLevelAreas,
        riskyFiles,
        gitOperationsInProgress,
    };
}

function isSharedBranch(branch: string | null): boolean {
    if (!branch) {
        return false;
    }
    return /^(main|master|develop|development|staging|prod|production)$/.test(branch) ||
        /^(release|hotfix)\//.test(branch);
}

function buildCommitDecision(state: RepoState): Decision {
    const reasons: string[] = [];
    const nextSteps: string[] = [];

    if (state.changedFiles.length === 0) {
        return {
            status: 'noop',
            reasons: ['Working tree pulito: non ci sono modifiche da committare.'],
            nextSteps: ['Nessuna azione git richiesta sul commit.'],
        };
    }

    if (!state.branch) {
        return {
            status: 'blocked',
            reasons: ['HEAD detached: manca un branch esplicito su cui chiudere l\'unità di lavoro.'],
            nextSteps: ['Passa a un branch esplicito prima di considerare il commit automatico.'],
        };
    }

    if (state.gitOperationsInProgress.length > 0) {
        return {
            status: 'blocked',
            reasons: [
                `Operazione git in corso: ${state.gitOperationsInProgress.join(', ')}. Il commit automatico non deve sovrapporsi.`,
            ],
            nextSteps: ['Chiudi o annulla l\'operazione git in corso, poi riesegui l\'audit.'],
        };
    }

    if (state.riskyFiles.length > 0) {
        return {
            status: 'blocked',
            reasons: [
                `File sensibili nel working tree: ${state.riskyFiles.join(', ')}. La policy vieta il commit automatico di env/chiavi/certificati.`,
            ],
            nextSteps: ['Rimuovi o separa i file sensibili dal working tree prima di committare.'],
        };
    }

    if (state.stagedCount > 0 && state.unstagedCount > 0) {
        reasons.push(
            'Index e working tree sono misti: ci sono file staged e anche modifiche unstaged. Serve confermare lo scope reale del commit.',
        );
        nextSteps.push('Allinea index e working tree: o stage completo dell\'unità logica o separazione delle modifiche residue.');
    }

    if (state.stagedCount === 0 && state.changedFiles.length > 3) {
        reasons.push(
            'Nessun file staged e working tree ampio: il sistema non deve decidere da solo quali file appartengono davvero all\'unità logica corrente.',
        );
        nextSteps.push('Stage solo i file dell\'unità verificata, poi rilancia l\'audit o usa la skill `git-commit`.');
    }

    if (state.topLevelAreas.length > 3) {
        reasons.push(
            `Le modifiche toccano ${state.topLevelAreas.length} aree (${state.topLevelAreas.join(', ')}): possibile mix di unità logiche o tracking/documentazione insieme al codice.`,
        );
        nextSteps.push('Verifica che il commit resti atomico e che non includa modifiche non correlate.');
    }

    if (state.changedFiles.length > 15) {
        reasons.push(`Working tree esteso (${state.changedFiles.length} file): il commit va trattato come review assistita, non come auto-chiusura cieca.`);
        nextSteps.push('Riduci il perimetro oppure conferma che il blocco sia davvero unico e già verificato.');
    }

    if (reasons.length > 0) {
        return {
            status: 'review',
            reasons,
            nextSteps,
        };
    }

    return {
        status: 'ready',
        reasons: [
            'Il working tree è coerente con un singolo blocco piccolo e non mostra segnali strutturali che impediscano il commit assistito.',
        ],
        nextSteps: ['Chiudi il blocco con `git-commit` o con un commit manuale intenzionale dopo i gate verdi.'],
    };
}

function buildPushDecision(state: RepoState): Decision {
    if (!state.branch) {
        return {
            status: 'blocked',
            reasons: ['HEAD detached: il push non può essere governato correttamente senza un branch esplicito.'],
            nextSteps: ['Passa a un branch esplicito prima di valutare il push.'],
        };
    }

    if (state.gitOperationsInProgress.length > 0) {
        return {
            status: 'blocked',
            reasons: [
                `Operazione git in corso: ${state.gitOperationsInProgress.join(', ')}. Il push automatico deve fermarsi finche' il repository non torna stabile.`,
            ],
            nextSteps: ['Chiudi l\'operazione git in corso e rilancia l\'audit.'],
        };
    }

    if (state.changedFiles.length > 0) {
        return {
            status: 'blocked',
            reasons: ['Ci sono ancora modifiche non committate: il push non deve partire prima di una chiusura locale coerente.'],
            nextSteps: ['Completa commit e quality gate del blocco prima di valutare il push.'],
        };
    }

    if (!state.upstream) {
        const reason = state.originUrl
            ? 'Branch senza upstream: il remote esiste ma la strategia di push non e\' ancora esplicita.'
            : 'Nessun upstream e nessun remote origin rilevato: il contesto remote non e\' abbastanza chiaro.';
        return {
            status: state.originUrl ? 'review' : 'blocked',
            reasons: [reason],
            nextSteps: state.originUrl
                ? [`Se il branch e' corretto, usa \`git push -u origin ${state.branch}\` o apri PR se la policy lo richiede.`]
                : ['Configura il remote corretto prima di considerare qualsiasi push automatico.'],
        };
    }

    if (state.behind > 0) {
        return {
            status: 'blocked',
            reasons: [`Il branch locale e' indietro di ${state.behind} commit rispetto a ${state.upstream}: push automatico vietato per rischio divergenza.`],
            nextSteps: ['Riallinea il branch con il remote e risolvi eventuali conflitti prima di pushare.'],
        };
    }

    if (state.ahead === 0) {
        return {
            status: 'noop',
            reasons: [`Nessun commit locale da inviare a ${state.upstream}.`],
            nextSteps: ['Nessuna azione di push richiesta.'],
        };
    }

    if (isSharedBranch(state.branch)) {
        return {
            status: 'review',
            reasons: [
                `Il branch corrente (${state.branch}) sembra condiviso o protetto: il push richiede valutazione contestuale, non automatismo cieco.`,
            ],
            nextSteps: ['Conferma se il flusso corretto è push diretto o PR/review prima del remote.'],
        };
    }

    return {
        status: 'ready',
        reasons: [
            `Branch pulito, upstream presente (${state.upstream}), ahead ${state.ahead}, behind ${state.behind}: il push e' tecnicamente pronto.`,
        ],
        nextSteps: ['Se la policy di integrazione lo consente, il push puo\' partire in modo assistito.'],
    };
}

function statusIcon(status: DecisionStatus): string {
    switch (status) {
        case 'ready':
            return '✅';
        case 'review':
            return '⚠️';
        case 'blocked':
            return '❌';
        case 'noop':
            return 'ℹ️';
    }
}

function statusLabel(status: DecisionStatus): string {
    switch (status) {
        case 'ready':
            return 'READY';
        case 'review':
            return 'REVIEW';
        case 'blocked':
            return 'BLOCKED';
        case 'noop':
            return 'NOOP';
    }
}

function printDecision(title: string, decision: Decision): void {
    console.log(`--- ${title} ---`);
    console.log(`${statusIcon(decision.status)} ${statusLabel(decision.status)}`);
    decision.reasons.forEach((reason) => console.log(`  - ${reason}`));
    if (decision.nextSteps.length > 0) {
        console.log('  Next:');
        decision.nextSteps.forEach((step) => console.log(`  - ${step}`));
    }
    console.log('');
}

function getStrictTarget(args: string[]): StrictTarget {
    const strictArg = args.find((arg) => arg.startsWith('--strict='));
    if (!strictArg) {
        return null;
    }
    const value = strictArg.split('=')[1];
    return value === 'commit' || value === 'push' ? value : null;
}

function shouldFailStrict(decision: Decision): boolean {
    return decision.status === 'review' || decision.status === 'blocked';
}

function run(): void {
    const args = process.argv.slice(2);
    const jsonMode = args.includes('--json');
    const strictTarget = getStrictTarget(args);
    const state = readRepoState();
    const commitDecision = buildCommitDecision(state);
    const pushDecision = buildPushDecision(state);

    const report: AuditReport = {
        generatedAt: new Date().toISOString(),
        repo: {
            rootDir: state.rootDir,
            gitDir: state.gitDir,
            branch: state.branch,
            upstream: state.upstream,
            originUrl: state.originUrl,
            ahead: state.ahead,
            behind: state.behind,
        },
        workingTree: {
            changedFiles: state.changedFiles.length,
            stagedCount: state.stagedCount,
            unstagedCount: state.unstagedCount,
            untrackedCount: state.untrackedCount,
            topLevelAreas: state.topLevelAreas,
            riskyFiles: state.riskyFiles,
            gitOperationsInProgress: state.gitOperationsInProgress,
        },
        decisions: {
            commit: commitDecision,
            push: pushDecision,
        },
    };

    if (jsonMode) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log('\n=== Git Automation Audit ===');
        console.log(`Data: ${report.generatedAt.split('T')[0]}`);
        console.log(`Repo: ${report.repo.rootDir}`);
        console.log(`Branch: ${report.repo.branch ?? '(detached HEAD)'}`);
        console.log(`Upstream: ${report.repo.upstream ?? '(nessuno)'}`);
        console.log(`Origin: ${report.repo.originUrl ?? '(nessun origin)'}`);
        console.log(`Ahead/Behind: ${report.repo.ahead}/${report.repo.behind}`);
        console.log(
            `Working tree: ${report.workingTree.changedFiles} file (staged ${report.workingTree.stagedCount}, unstaged ${report.workingTree.unstagedCount}, untracked ${report.workingTree.untrackedCount})`,
        );
        console.log(
            `Aree toccate: ${report.workingTree.topLevelAreas.length > 0 ? report.workingTree.topLevelAreas.join(', ') : '(nessuna)'}`,
        );
        console.log(
            `Operazioni git in corso: ${report.workingTree.gitOperationsInProgress.length > 0 ? report.workingTree.gitOperationsInProgress.join(', ') : 'nessuna'}`,
        );
        if (report.workingTree.riskyFiles.length > 0) {
            console.log(`File sensibili rilevati: ${report.workingTree.riskyFiles.join(', ')}`);
        }
        console.log('');

        printDecision('Commit', commitDecision);
        printDecision('Push', pushDecision);
    }

    if (strictTarget === 'commit' && shouldFailStrict(commitDecision)) {
        process.exit(1);
    }
    if (strictTarget === 'push' && shouldFailStrict(pushDecision)) {
        process.exit(1);
    }
}

run();
