declare module '@ikechan8370/cycletls' {
    interface CycleTlsServerOptions {
        port: number;
        ja3: string;
        userAgent: string;
        proxy?: string;
    }

    interface CycleTlsServerHandle {
        close?: () => void | Promise<void>;
        stop?: () => void | Promise<void>;
        shutdown?: () => void | Promise<void>;
    }

    interface CycleTlsClient {
        server: (options: CycleTlsServerOptions) => CycleTlsServerHandle | Promise<CycleTlsServerHandle>;
        exit?: () => void | Promise<void>;
    }

    export default function initCycleTLS(): Promise<CycleTlsClient>;
}
