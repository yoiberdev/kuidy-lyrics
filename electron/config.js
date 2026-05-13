const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function configPath() {
  return path.join(app.getPath('userData'), 'kuidy-config.json');
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), 'utf8');
  } catch (err) {
    console.error('[config] save failed:', err.message);
  }
}

function tokensPath() {
  return path.join(app.getPath('userData'), 'kuidy-tokens.json');
}

function loadTokens() {
  try {
    return JSON.parse(fs.readFileSync(tokensPath(), 'utf8'));
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  try {
    fs.mkdirSync(path.dirname(tokensPath()), { recursive: true });
    fs.writeFileSync(tokensPath(), JSON.stringify(tokens, null, 2), 'utf8');
  } catch (err) {
    console.error('[tokens] save failed:', err.message);
  }
}

function clearTokens() {
  try {
    fs.unlinkSync(tokensPath());
  } catch {
    // ignore
  }
}

module.exports = { loadConfig, saveConfig, loadTokens, saveTokens, clearTokens };
