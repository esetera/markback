/**
 * Plugins: a folder with a plugin.json and plain JavaScript, kept under <home>/plugins/<name>. A plugin adds commands
 * (`review <plugin> <command>`) and exports (`review export --as <name>`: answers in, text out). Nothing to install.
 *
 * A plugin runs code on this computer, so adding one says what it adds and asks first. plugin.json says whether it uses the
 * network; nothing here can stop one that lies, which is why the question is asked.
 *
 *   { "name": "marks-to-markdown", "version": "1.0.0", "description": "…",
 *     "commands": { "hello": "hello.js" }, "exports": { "markdown": "markdown.js" }, "network": false }
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { OWN_HOME } from './store.mjs'

// Your own folder, never a store a project's .markback named: a project must not bring plugins that run unasked.
export const PLUGINS = join(OWN_HOME, 'plugins')
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/
/** Names a plugin cannot take: Markback's own commands. */
export const TAKEN = ['start', 'stop', 'check', 'see', 'pdf', 'demo', 'sketch', 'push', 'list', 'wait', 'read', 'clear', 'ideas', 'queue', 'take', 'show', 'note', 'stage', 'project', 'open', 'install-skills', 'plugin', 'export', 'help']

const readJson = path => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** What a folder's plugin.json says, checked: a name, files that exist inside the folder, and at least one thing added. */
export function readPlugin(dir) {
  const meta = readJson(join(dir, 'plugin.json'))
  if (!meta) throw new Error(`No plugin.json that reads as JSON in ${dir}`)
  if (!NAME.test(String(meta.name ?? ''))) throw new Error('plugin.json needs a name: lowercase letters, numbers and dashes.')
  if (TAKEN.includes(meta.name)) throw new Error(`${meta.name} is one of Markback's own commands. Choose another name.`)
  const parts = {}
  for (const kind of ['commands', 'exports']) {
    parts[kind] = {}
    for (const [name, file] of Object.entries(meta[kind] ?? {})) {
      if (!NAME.test(name)) throw new Error(`${kind} names are lowercase letters, numbers and dashes: ${name}`)
      const path = resolve(dir, String(file))
      if (!existsSync(path)) throw new Error(`${file} is named in plugin.json but is not there.`)
      // Where it really is, links followed: a link inside the folder may point anywhere.
      if (!realpathSync(path).startsWith(realpathSync(dir) + sep)) throw new Error(`${file} is outside the plugin's folder.`)
      parts[kind][name] = path
    }
  }
  if (!Object.keys(parts.commands).length && !Object.keys(parts.exports).length) throw new Error('plugin.json adds nothing: give it commands or exports.')
  return { name: meta.name, version: String(meta.version ?? ''), description: String(meta.description ?? ''), network: meta.network === true, ...parts, dir }
}

/** One line on what it adds, for the question before adding and for the list. */
export const addsWords = p =>
  [
    ...Object.keys(p.commands).map(c => `command review ${p.name} ${c}`),
    ...Object.keys(p.exports).map(e => `export ${e}`),
  ].join(', ') + (p.network ? '. Uses the network.' : '. No network.')

/** The plugins in a folder: itself, or each folder in it that has a plugin.json (a repository can hold several). */
export function pluginsIn(dir) {
  if (existsSync(join(dir, 'plugin.json'))) return [readPlugin(dir)]
  const found = readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.') && existsSync(join(dir, d.name, 'plugin.json')))
    .map(d => readPlugin(join(dir, d.name)))
  if (!found.length) throw new Error(`No plugin.json in ${dir}, nor in the folders in it.`)
  return found
}

/** A local folder as it is, or a git address cloned into a folder that is thrown away after. */
export function fetchSource(source) {
  if (existsSync(source)) return { dir: resolve(source), done: () => {} }
  if (!/^(https:\/\/|git@)[\w.@:/~-]+$/.test(source)) throw new Error(`${source} is neither a folder here nor a git address.`)
  const dir = mkdtempSync(join(tmpdir(), 'markback-plugin-'))
  // Arguments, not a shell: the address is never read as a command.
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '--', source, dir], { stdio: ['ignore', 'ignore', 'pipe'] })
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Copies the plugins in, replacing older copies of the same name. */
export function addPlugins(plugins) {
  mkdirSync(PLUGINS, { recursive: true })
  for (const p of plugins) {
    const to = join(PLUGINS, p.name)
    rmSync(to, { recursive: true, force: true })
    // Links copied as the files they point to, so nothing points back into a fetched copy that is then thrown away; a link
    // that leads outside the plugin's folder is left out, so no link can pull in half the disk.
    const inside = realpathSync(p.dir) + sep
    const keep = from => {
      if (/\/\.git(\/|$)/.test(from)) return false
      if (!lstatSync(from).isSymbolicLink()) return true
      try {
        return realpathSync(from).startsWith(inside)
      } catch {
        return false
      }
    }
    cpSync(p.dir, to, { recursive: true, dereference: true, filter: keep })
  }
}

export const listPlugins = () =>
  existsSync(PLUGINS)
    ? readdirSync(PLUGINS).flatMap(name => {
        try {
          return [readPlugin(join(PLUGINS, name))]
        } catch {
          return []
        }
      })
    : []

export function removePlugin(name) {
  const dir = join(PLUGINS, String(name))
  if (!NAME.test(String(name)) || !existsSync(dir)) throw new Error(`No plugin called ${name}.`)
  rmSync(dir, { recursive: true, force: true })
}

const load = async path => (await import(pathToFileURL(path).href)).default

/** Runs a plugin's command. With one command, its name can be left out. */
export async function runCommand(name, commandName, context) {
  const p = listPlugins().find(x => x.name === name)
  if (!p) return false
  const names = Object.keys(p.commands)
  const named = commandName && p.commands[commandName]
  const chosen = named ? commandName : names.length === 1 ? names[0] : null
  if (!chosen) throw new Error(`${name} has the commands: ${names.join(', ') || 'none'}.`)
  const fn = await load(p.commands[chosen])
  if (typeof fn !== 'function') throw new Error(`${p.commands[chosen]} does not export a function.`)
  // A command gets the words after its own name.
  await fn({ ...context, args: named ? context.args.slice(1) : context.args })
  return true
}

/** Turns answers into text with an export a plugin adds. */
export async function runExport(as, answers, context) {
  const p = listPlugins().find(x => x.exports[as])
  if (!p) throw new Error(`No plugin adds an export called ${as}. See: review plugin list`)
  const fn = await load(p.exports[as])
  if (typeof fn !== 'function') throw new Error(`${p.exports[as]} does not export a function.`)
  return String(await fn(answers, context))
}
