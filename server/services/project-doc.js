const fs = require('fs');
const path = require('path');

function generateProjectDoc(projectPath, name, description) {
  const docPath = path.join(projectPath, 'PROJECT.md');

  // Don't overwrite existing PROJECT.md
  if (fs.existsSync(docPath)) return;

  // Analyze the project directory
  const analysis = analyzeProject(projectPath);

  const content = `# ${name}

> ${description || 'No description provided.'}

## Project Overview
- **Path:** \`${projectPath}\`
- **Generated:** ${new Date().toISOString().split('T')[0]}

## Tech Stack
${analysis.techStack.map((t) => `- ${t}`).join('\n') || '- Not detected'}

## Project Structure
\`\`\`
${analysis.structure}
\`\`\`

## Key Files
${analysis.keyFiles.map((f) => `- \`${f}\``).join('\n') || '- None detected'}

## Architecture Notes
_This section is auto-updated by agents as they work on the project._

## API Documentation
_Auto-populated by agents._

## Data Models
_Auto-populated by agents._
`;

  fs.writeFileSync(docPath, content);
  return docPath;
}

function analyzeProject(projectPath) {
  const techStack = [];
  const keyFiles = [];

  // Check for package.json
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

      if (!techStack.length) techStack.push('Node.js');
      keyFiles.push('package.json');
    } catch {}
  }

  // Check for Python
  if (fs.existsSync(path.join(projectPath, 'requirements.txt'))) {
    techStack.push('Python');
    keyFiles.push('requirements.txt');
  }
  if (fs.existsSync(path.join(projectPath, 'pyproject.toml'))) {
    techStack.push('Python');
    keyFiles.push('pyproject.toml');
  }

  // Check for Go
  if (fs.existsSync(path.join(projectPath, 'go.mod'))) {
    techStack.push('Go');
    keyFiles.push('go.mod');
  }

  // Check for Rust
  if (fs.existsSync(path.join(projectPath, 'Cargo.toml'))) {
    techStack.push('Rust');
    keyFiles.push('Cargo.toml');
  }

  // Check for Docker
  if (fs.existsSync(path.join(projectPath, 'Dockerfile'))) {
    techStack.push('Docker');
    keyFiles.push('Dockerfile');
  }
  if (fs.existsSync(path.join(projectPath, 'docker-compose.yml'))) {
    keyFiles.push('docker-compose.yml');
  }

  // Config files
  for (const f of ['tsconfig.json', '.env.example', 'Makefile', '.github']) {
    if (fs.existsSync(path.join(projectPath, f))) keyFiles.push(f);
  }

  // Build directory structure (shallow)
  const structure = buildStructureString(projectPath, '', 0, 2);

  return { techStack: [...new Set(techStack)], keyFiles, structure };
}

function buildStructureString(dirPath, prefix, depth, maxDepth) {
  if (depth >= maxDepth) return '';

  const ignoreList = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'target'];
  let result = '';

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((e) => !ignoreList.includes(e.name) && !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() === b.isDirectory()) return a.name.localeCompare(b.name);
        return a.isDirectory() ? -1 : 1;
      });

    entries.forEach((entry, i) => {
      const isLast = i === entries.length - 1;
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

module.exports = { generateProjectDoc, analyzeProject };
