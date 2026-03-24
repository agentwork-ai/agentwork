const fs = require('fs');
const path = require('path');

const PROJECT_TEMPLATE_OPTIONS = [
  {
    id: 'generic',
    label: 'Generic',
    description: 'Current default template. Broad project overview with lightweight structure and architecture notes.',
  },
  {
    id: 'ios',
    label: 'iOS App',
    description: 'Swift / SwiftUI / UIKit projects with Xcode targets, schemes, signing, and release workflow notes.',
  },
  {
    id: 'android',
    label: 'Android App',
    description: 'Kotlin / Java Android projects with modules, flavors, Gradle commands, and signing notes.',
  },
  {
    id: 'flutter',
    label: 'Flutter App',
    description: 'Cross-platform Flutter apps with Dart structure, mobile targets, state management, and release concerns.',
  },
  {
    id: 'react-native',
    label: 'React Native App',
    description: 'React Native apps with JavaScript/TypeScript plus iOS and Android native integration notes.',
  },
  {
    id: 'python',
    label: 'Python App',
    description: 'Python services, scripts, or web apps with environment, framework, testing, and worker guidance.',
  },
  {
    id: 'node-api',
    label: 'Node API / Service',
    description: 'Backend APIs or services with routes, jobs, database layers, and deployment/runtime commands.',
  },
  {
    id: 'nextjs',
    label: 'Next.js Web App',
    description: 'Next.js app template with routing, data loading, styling, auth, and deployment checkpoints.',
  },
  {
    id: 'web-frontend',
    label: 'Web Frontend',
    description: 'General web frontend template for React/Vue/SPA projects with UX, state, and asset organization notes.',
  },
  {
    id: 'go',
    label: 'Go Service',
    description: 'Go applications and services with module layout, binaries, configuration, and operational notes.',
  },
];

const TEMPLATE_MAP = new Map(PROJECT_TEMPLATE_OPTIONS.map((template) => [template.id, template]));

function normalizeProjectTemplate(value) {
  const templateId = String(value || '').trim().toLowerCase();
  return TEMPLATE_MAP.has(templateId) ? templateId : 'generic';
}

function listProjectTemplates() {
  return PROJECT_TEMPLATE_OPTIONS;
}

function generateProjectDoc(projectPath, name, description, template = 'generic', options = {}) {
  const docPath = path.join(projectPath, 'PROJECT.md');

  if (fs.existsSync(docPath) && !options.force) return docPath;

  const templateId = normalizeProjectTemplate(template);
  const analysis = analyzeProject(projectPath);
  const content = buildProjectDocContent({
    projectPath,
    name,
    description,
    templateId,
    analysis,
  });

  fs.writeFileSync(docPath, content);
  return docPath;
}

function buildProjectDocContent({ projectPath, name, description, templateId, analysis }) {
  const template = TEMPLATE_MAP.get(templateId) || TEMPLATE_MAP.get('generic');
  const sections = [
    `# ${name}`,
    `> ${description || 'No description provided.'}`,
    `## Project Overview
- **Path:** \`${projectPath}\`
- **Template:** ${template.label}
- **Generated:** ${new Date().toISOString().split('T')[0]}`,
    `## Template Guidance
${template.description}`,
    `## Tech Stack
${formatBullets(analysis.techStack) || '- Not detected'}`,
    `## Project Structure
\`\`\`
${analysis.structure || '(No files detected yet)'}
\`\`\``,
    `## Key Files
${formatBullets(analysis.keyFiles.map((file) => `\`${file}\``)) || '- None detected'}`,
    `## Suggested Commands
${formatBullets(getSuggestedCommands(templateId, analysis)) || '- Add project-specific commands here.'}`,
    `## Architecture Focus
${formatBullets(getArchitectureFocus(templateId)) || '- Document important architectural constraints here.'}`,
  ];

  for (const section of getTemplateExtraSections(templateId)) {
    sections.push(`## ${section.title}\n${formatBullets(section.items) || section.fallback || '- Fill this in as the project becomes clearer.'}`);
  }

  sections.push(
    '## Architecture Notes\n_This section is auto-updated by agents as they work on the project._',
    '## API Documentation\n_Auto-populated by agents._',
    '## Data Models\n_Auto-populated by agents._',
  );

  return sections.join('\n\n') + '\n';
}

function analyzeProject(projectPath) {
  const techStack = [];
  const keyFiles = [];

  const pkgPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (deps.react) techStack.push('React');
      if (deps.next) techStack.push('Next.js');
      if (deps.vue) techStack.push('Vue.js');
      if (deps.express) techStack.push('Express');
      if (deps.typescript) techStack.push('TypeScript');
      if (deps.tailwindcss) techStack.push('Tailwind CSS');
      if (deps.prisma || deps['@prisma/client']) techStack.push('Prisma');
      if (deps.mongoose) techStack.push('MongoDB/Mongoose');
      if (deps['react-native']) techStack.push('React Native');
      if (!techStack.length) techStack.push('Node.js');
      keyFiles.push('package.json');
    } catch {}
  }

  if (fs.existsSync(path.join(projectPath, 'pubspec.yaml'))) {
    techStack.push('Flutter');
    keyFiles.push('pubspec.yaml');
  }

  let hasXcodeProject = false;
  try {
    hasXcodeProject = fs.readdirSync(projectPath, { withFileTypes: true })
      .some((entry) => entry.name.endsWith('.xcodeproj') || entry.name.endsWith('.xcworkspace'));
  } catch {}
  if (hasXcodeProject || fs.existsSync(path.join(projectPath, 'Podfile'))) {
    techStack.push('iOS / Xcode');
    if (hasXcodeProject) keyFiles.push('*.xcodeproj / *.xcworkspace');
    if (fs.existsSync(path.join(projectPath, 'Podfile'))) keyFiles.push('Podfile');
  }

  if (
    fs.existsSync(path.join(projectPath, 'settings.gradle'))
    || fs.existsSync(path.join(projectPath, 'settings.gradle.kts'))
    || fs.existsSync(path.join(projectPath, 'app', 'src', 'main', 'AndroidManifest.xml'))
  ) {
    techStack.push('Android / Gradle');
    if (fs.existsSync(path.join(projectPath, 'app', 'src', 'main', 'AndroidManifest.xml'))) {
      keyFiles.push('app/src/main/AndroidManifest.xml');
    }
  }

  for (const pythonFile of ['requirements.txt', 'pyproject.toml', 'Pipfile']) {
    if (fs.existsSync(path.join(projectPath, pythonFile))) {
      techStack.push('Python');
      keyFiles.push(pythonFile);
    }
  }

  if (fs.existsSync(path.join(projectPath, 'manage.py'))) {
    techStack.push('Django');
    keyFiles.push('manage.py');
  }
  if (fs.existsSync(path.join(projectPath, 'alembic.ini'))) {
    techStack.push('Alembic');
    keyFiles.push('alembic.ini');
  }
  if (fs.existsSync(path.join(projectPath, 'go.mod'))) {
    techStack.push('Go');
    keyFiles.push('go.mod');
  }
  if (fs.existsSync(path.join(projectPath, 'Cargo.toml'))) {
    techStack.push('Rust');
    keyFiles.push('Cargo.toml');
  }
  if (fs.existsSync(path.join(projectPath, 'Dockerfile'))) {
    techStack.push('Docker');
    keyFiles.push('Dockerfile');
  }
  if (fs.existsSync(path.join(projectPath, 'docker-compose.yml'))) {
    keyFiles.push('docker-compose.yml');
  }
  if (fs.existsSync(path.join(projectPath, 'fastlane'))) {
    keyFiles.push('fastlane/');
  }

  for (const file of ['tsconfig.json', '.env.example', 'Makefile', '.github', 'turbo.json', 'pnpm-workspace.yaml']) {
    if (fs.existsSync(path.join(projectPath, file))) keyFiles.push(file);
  }

  const structure = buildStructureString(projectPath, '', 0, 2);
  return {
    techStack: [...new Set(techStack)],
    keyFiles: [...new Set(keyFiles)],
    structure,
  };
}

function formatBullets(items) {
  const list = (items || []).filter(Boolean);
  return list.length ? list.map((item) => `- ${item}`).join('\n') : '';
}

function getSuggestedCommands(templateId, analysis) {
  const shared = [
    'Document the real build, test, and lint commands once they are confirmed.',
  ];

  const commands = {
    generic: ['Run the project locally', 'Run tests', 'Run lint / formatting checks'],
    ios: [
      '`xcodebuild -scheme <Scheme> -destination "platform=iOS Simulator,name=iPhone 15"`',
      '`xcodebuild test -scheme <Scheme> -destination "platform=iOS Simulator,name=iPhone 15"`',
      '`fastlane <lane>` if Fastlane is configured',
    ],
    android: [
      '`./gradlew assembleDebug`',
      '`./gradlew test`',
      '`./gradlew lint`',
    ],
    flutter: [
      '`flutter pub get`',
      '`flutter run`',
      '`flutter test`',
      '`flutter build ios` / `flutter build apk`',
    ],
    'react-native': [
      '`npm install` or `yarn install`',
      '`npx react-native start`',
      '`npx react-native run-ios`',
      '`npx react-native run-android`',
      '`npm test`',
    ],
    python: [
      '`python -m venv .venv` or use the project environment manager',
      '`pip install -r requirements.txt` or `uv sync` / `poetry install`',
      '`pytest`',
      '`ruff check .` or the project lint command',
    ],
    'node-api': [
      '`npm install` / `pnpm install`',
      '`npm run dev`',
      '`npm test`',
      '`npm run lint`',
    ],
    nextjs: [
      '`npm install` / `pnpm install`',
      '`npm run dev`',
      '`npm run build`',
      '`npm run lint`',
    ],
    'web-frontend': [
      '`npm install` / `pnpm install`',
      '`npm run dev`',
      '`npm test`',
      '`npm run build`',
    ],
    go: [
      '`go test ./...`',
      '`go run ./...` or the main package entrypoint',
      '`go build ./...`',
      '`golangci-lint run` if configured',
    ],
  };

  const detected = analysis.techStack.includes('Docker') ? ['`docker compose up` if local infrastructure is required'] : [];
  return [...(commands[templateId] || commands.generic), ...detected, ...shared];
}

function getArchitectureFocus(templateId) {
  const focus = {
    generic: [
      'Core project purpose and business domain',
      'Directory responsibilities and module boundaries',
      'Important commands, environments, and operational caveats',
    ],
    ios: [
      'App targets, schemes, bundle identifiers, and minimum iOS version',
      'Navigation architecture, state management, and shared UI patterns',
      'Networking, persistence, background tasks, and release/signing setup',
    ],
    android: [
      'Modules, build flavors, build types, and SDK/version constraints',
      'Navigation, dependency injection, state management, and offline/data layers',
      'Signing, Play distribution, feature flags, and crash/reporting tooling',
    ],
    flutter: [
      'Feature/module layout across `lib/`, `ios/`, and `android/`',
      'State management approach, routing, theming, and platform channel usage',
      'Flavor/build configuration and store release workflow',
    ],
    'react-native': [
      'JS/TS app structure and how native iOS/Android code is integrated',
      'Navigation, state/data fetching, and environment configuration',
      'Native module ownership, Metro/build setup, and release workflow',
    ],
    python: [
      'Entrypoints, package layout, and runtime/environment expectations',
      'Framework structure, background jobs, and data/storage integrations',
      'Tests, migrations, deploy/runtime processes, and operational scripts',
    ],
    'node-api': [
      'Route/controller/service layering and domain ownership',
      'Database access, queues/jobs, caching, and third-party integrations',
      'Runtime configuration, deployment shape, and observability',
    ],
    nextjs: [
      'App Router / Pages Router structure and server/client boundaries',
      'Data fetching, auth/session handling, and environment variables',
      'UI system, asset strategy, and deployment/runtime constraints',
    ],
    'web-frontend': [
      'Feature/page structure and shared component boundaries',
      'State management, API/data layer, and routing',
      'Design system, build setup, and deployment expectations',
    ],
    go: [
      'Package boundaries, binaries, and shared internal libraries',
      'Configuration, transport layers, and concurrency model',
      'Operational commands, deploy shape, and reliability considerations',
    ],
  };

  return focus[templateId] || focus.generic;
}

function getTemplateExtraSections(templateId) {
  const sections = {
    ios: [
      {
        title: 'iOS Delivery Notes',
        items: [
          'Document schemes, targets, bundle IDs, capabilities, and signing requirements.',
          'Track TestFlight/App Store workflow, provisioning dependencies, and release checklists.',
        ],
      },
    ],
    android: [
      {
        title: 'Android Delivery Notes',
        items: [
          'Document product flavors, signing configs, Play Console workflow, and release tracks.',
          'Capture minSdk/targetSdk constraints and any device-specific caveats.',
        ],
      },
    ],
    flutter: [
      {
        title: 'Cross-Platform Notes',
        items: [
          'Track platform divergences between iOS, Android, and any desktop/web targets.',
          'Document flavor/environment handling and shared vs platform-specific code ownership.',
        ],
      },
    ],
    'react-native': [
      {
        title: 'Native Integration Notes',
        items: [
          'List native modules, pods/Gradle dependencies, and platform-specific setup steps.',
          'Document OTA/update strategy, if any, and native build troubleshooting hotspots.',
        ],
      },
    ],
    python: [
      {
        title: 'Environment Notes',
        items: [
          'Record Python version, dependency manager, secrets/config strategy, and deployment entrypoints.',
          'Capture migration, worker, cron, and background processing conventions.',
        ],
      },
    ],
    'node-api': [
      {
        title: 'Service Operations',
        items: [
          'Record queue workers, cron jobs, webhooks, and third-party dependencies.',
          'Document required env vars, local infrastructure, and deployment/runtime assumptions.',
        ],
      },
    ],
    nextjs: [
      {
        title: 'Rendering Notes',
        items: [
          'Document server components, client components, edge/server runtime usage, and caching strategy.',
          'Record auth/session setup and how local/staging/production environments differ.',
        ],
      },
    ],
    'web-frontend': [
      {
        title: 'Frontend Delivery Notes',
        items: [
          'Document build/deploy targets, environment-based APIs, and analytics/monitoring integrations.',
          'Track accessibility, browser support, and performance budgets where relevant.',
        ],
      },
    ],
    go: [
      {
        title: 'Operational Notes',
        items: [
          'Document process model, configuration sources, and health/readiness endpoints.',
          'Capture any code generation, migrations, and local service dependencies.',
        ],
      },
    ],
  };

  return sections[templateId] || [];
}

function buildStructureString(dirPath, prefix, depth, maxDepth) {
  if (depth >= maxDepth) return '';

  const ignoreList = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'target'];
  let result = '';

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => !ignoreList.includes(entry.name) && !entry.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() === b.isDirectory()) return a.name.localeCompare(b.name);
        return a.isDirectory() ? -1 : 1;
      });

    entries.forEach((entry, index) => {
      const isLast = index === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';

      result += `${prefix}${connector}${entry.name}${entry.isDirectory() ? '/' : ''}\n`;

      if (entry.isDirectory()) {
        result += buildStructureString(
          path.join(dirPath, entry.name),
          prefix + childPrefix,
          depth + 1,
          maxDepth
        );
      }
    });
  } catch {}

  return result;
}

module.exports = {
  PROJECT_TEMPLATE_OPTIONS,
  normalizeProjectTemplate,
  listProjectTemplates,
  generateProjectDoc,
  analyzeProject,
};
