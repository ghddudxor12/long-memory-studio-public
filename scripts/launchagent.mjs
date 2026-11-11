// Usage: node scripts/launchagent.mjs install|uninstall|status
// Starts the Long Memory Studio server (app + worker) at login via a macOS LaunchAgent (com.longmemory.studio).
// The server then renders, runs TTS/QC/proxy and Codex image jobs without any terminal.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root } from './lib/paths.mjs';

const label = 'com.longmemory.studio';
const home = process.env.REAL_HOME || process.env.HOME;
const plist = path.join(home, 'Library', 'LaunchAgents', `${label}.plist`);
const node = process.execPath;
const cmd = process.argv[2] || 'status';
const uid = execFileSync('/usr/bin/id', ['-u']).toString().trim();

if (cmd === 'install') {
  fs.mkdirSync(path.dirname(plist), { recursive: true });
  fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>${path.join(root, 'app', 'server.mjs')}</string></array>
  <key>WorkingDirectory</key><string>${root}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:${path.dirname(node)}</string><key>HOME</key><string>${home}</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(home, 'Library', 'Logs', 'long-memory-studio.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(home, 'Library', 'Logs', 'long-memory-studio.log')}</string>
</dict></plist>
`);
  try { execFileSync('/bin/launchctl', ['bootout', `gui/${uid}/${label}`], { stdio: 'ignore' }); } catch {}
  execFileSync('/bin/launchctl', ['bootstrap', `gui/${uid}`, plist]);
  console.log(`installed ${plist} → http://127.0.0.1:5178 (log ~/Library/Logs/long-memory-studio.log)`);
} else if (cmd === 'uninstall') {
  try { execFileSync('/bin/launchctl', ['bootout', `gui/${uid}/${label}`]); } catch {}
  if (fs.existsSync(plist)) fs.unlinkSync(plist);
  console.log('uninstalled');
} else {
  console.log(fs.existsSync(plist) ? `plist: ${plist}` : 'not installed');
  try { console.log(execFileSync('/bin/launchctl', ['print', `gui/${uid}/${label}`]).toString().split('\n').filter((l) => /state|pid/.test(l)).join('\n')); } catch { console.log('not loaded'); }
}
