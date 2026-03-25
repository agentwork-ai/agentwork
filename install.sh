#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${AGENTWORK_PACKAGE_NAME:-agentwork}"
PACKAGE_VERSION="${AGENTWORK_VERSION:-latest}"
PACKAGE_SPEC="${PACKAGE_NAME}@${PACKAGE_VERSION}"
AGENTWORK_PORT="${AGENTWORK_PORT:-1248}"
AGENTWORK_START="${AGENTWORK_START:-1}"
AGENTWORK_NPM_PREFIX="${AGENTWORK_NPM_PREFIX:-$HOME/.local}"
NVM_INSTALL_URL="${NVM_INSTALL_URL:-https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh}"

info() {
  printf '\033[1;34m==>\033[0m %s\n' "$*"
}

warn() {
  printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2
}

die() {
  printf '\033[1;31merror:\033[0m %s\n' "$*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

node_major_version() {
  node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0
}

load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
  fi
}

ensure_path_has_npm_bins() {
  local npm_prefix
  npm_prefix="$(npm config get prefix 2>/dev/null || true)"
  if [ -n "$npm_prefix" ] && [ -d "$npm_prefix/bin" ]; then
    export PATH="$npm_prefix/bin:$PATH"
  fi
  if [ -d "$AGENTWORK_NPM_PREFIX/bin" ]; then
    export PATH="$AGENTWORK_NPM_PREFIX/bin:$PATH"
  fi
}

ensure_node() {
  if have node && have npm; then
    local major
    major="$(node_major_version)"
    if [ "$major" -ge 18 ]; then
      return
    fi
    warn "Node.js 18+ is required. Found $(node -v)."
  fi

  if have brew; then
    info "Installing Node.js with Homebrew..."
    brew install node
    return
  fi

  if have curl; then
    info "Installing nvm..."
    curl -fsSL "$NVM_INSTALL_URL" | bash
    load_nvm
    have nvm || die "nvm installation failed. Install Node.js 18+ manually and rerun this script."
    info "Installing Node.js LTS..."
    nvm install --lts
    nvm alias default 'lts/*' >/dev/null 2>&1 || true
    return
  fi

  die "Node.js 18+ and npm are required. Install them manually, then rerun this script."
}

resolve_agentwork_bin() {
  if have agentwork; then
    command -v agentwork
    return 0
  fi

  local npm_prefix
  npm_prefix="$(npm config get prefix 2>/dev/null || true)"
  if [ -n "$npm_prefix" ] && [ -x "$npm_prefix/bin/agentwork" ]; then
    printf '%s\n' "$npm_prefix/bin/agentwork"
    return 0
  fi

  if [ -x "$AGENTWORK_NPM_PREFIX/bin/agentwork" ]; then
    printf '%s\n' "$AGENTWORK_NPM_PREFIX/bin/agentwork"
    return 0
  fi

  return 1
}

install_agentwork() {
  info "Installing ${PACKAGE_SPEC}..."
  if npm install -g "$PACKAGE_SPEC"; then
    return
  fi

  warn "Global npm install failed. Retrying with a user-local prefix at ${AGENTWORK_NPM_PREFIX}."
  mkdir -p "$AGENTWORK_NPM_PREFIX"
  npm install -g --prefix "$AGENTWORK_NPM_PREFIX" "$PACKAGE_SPEC" || die "Failed to install ${PACKAGE_SPEC}."
}

start_agentwork() {
  if [ "$AGENTWORK_START" = "0" ]; then
    info "Skipping automatic startup because AGENTWORK_START=0."
    return
  fi

  local agentwork_bin
  agentwork_bin="$(resolve_agentwork_bin)" || die "agentwork command was not found after installation."

  info "Starting AgentWork on port ${AGENTWORK_PORT}..."
  "$agentwork_bin" start -p "$AGENTWORK_PORT"
  printf '\nDashboard: http://localhost:%s\n' "$AGENTWORK_PORT"
}

main() {
  ensure_node
  load_nvm || true
  ensure_path_has_npm_bins
  install_agentwork
  ensure_path_has_npm_bins

  local agentwork_bin
  agentwork_bin="$(resolve_agentwork_bin)" || die "agentwork command was not found after installation."

  info "Installed $("$agentwork_bin" --version | tail -n 1)"
  start_agentwork
}

main "$@"
