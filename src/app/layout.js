import './globals.css';
import Providers from './providers';

export const metadata = {
  title: 'AgentWork',
  description: 'Autonomous AI Agent Orchestrator',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0f0f17" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <link rel="icon" href="/icon.svg" />
      </head>
      <body>
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:rounded focus:bg-blue-600 focus:text-white">
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
