#!/usr/bin/env node
/**
 * Morning Briefing — LinkedIn Bot
 * Legge C:\Users\albie\memory\ e C:\Users\albie\todos\active.md
 * Invia un DM su Slack via webhook (SLACK_WEBHOOK_URL in .env)
 *
 * Uso: node scripts/morning-briefing.js
 * Schedulabile con Windows Task Scheduler alle 08:00.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

// Carica .env se presente
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach(line => {
      const [key, ...val] = line.split('=');
      if (key && val.length && !process.env[key]) {
        process.env[key.trim()] = val.join('=').trim();
      }
    });
}

const MEMORY_DIR = path.join(process.env.USERPROFILE || process.env.HOME, 'memory');
const TODOS_FILE = path.join(process.env.USERPROFILE || process.env.HOME, 'todos', 'active.md');

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function extractHighPriority(activeContent) {
  if (!activeContent) return ['Aggiorna active.md con le tue priorità'];
  const lines = activeContent.split('\n');
  const priorities = [];
  let inHighPriority = false;

  for (const line of lines) {
    if (line.includes('Alta priorità') || line.includes('🔥')) {
      inHighPriority = true;
      continue;
    }
    if (inHighPriority && (line.startsWith('## ') || line.startsWith('# '))) {
      break;
    }
    if (inHighPriority) {
      const match = line.match(/^\d+\.\s+\*\*(.+?)\*\*/);
      if (match) priorities.push(match[1]);
    }
  }

  return priorities.slice(0, 3).length > 0
    ? priorities.slice(0, 3)
    : ['Controlla active.md — nessuna priorità alta trovata'];
}

function generateBriefing() {
  const today = new Date().toLocaleDateString('it-IT', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const activeContent = readFile(TODOS_FILE);
  const priorities = extractHighPriority(activeContent);

  const priorityLines = priorities
    .map((p, i) => `${i + 1}. ${p}`)
    .join('\n');

  return [
    `🌅 *Buongiorno! Briefing del ${today}*`,
    '',
    `*📋 Top 3 priorità di oggi:*`,
    priorityLines,
    '',
    `_Aggiorna \`todos/active.md\` per cambiare le priorità di domani._`
  ].join('\n');
}

function sendToSlack(message) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (!webhookUrl) {
    console.log('⚠️  SLACK_WEBHOOK_URL non configurata. Briefing:');
    console.log(message);
    return;
  }

  const payload = JSON.stringify({ text: message });
  const url = new URL(webhookUrl);

  const req = https.request({
    hostname: url.hostname,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, (res) => {
    console.log(`Slack: ${res.statusCode === 200 ? '✅ inviato' : `❌ status ${res.statusCode}`}`);
  });

  req.on('error', (err) => {
    console.error('Errore Slack:', err.message);
  });

  req.write(payload);
  req.end();
}

const briefing = generateBriefing();
console.log(briefing);
sendToSlack(briefing);
