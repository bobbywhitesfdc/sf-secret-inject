import {SfCommand} from '@salesforce/sf-plugins-core'
import {existsSync} from 'node:fs'
import {copyFile, mkdir} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

const SKILL_DEST = join(homedir(), '.claude', 'skills', 'sf-secret-inject')

export default class SecretInstallSkill extends SfCommand<{installed: string}> {
  public static readonly description =
    'Copies the bundled SKILL.md to ~/.claude/skills/sf-secret-inject/ so Claude Code can use it as a skill.'
public static readonly examples = ['$ sf secret install-skill']
public static readonly summary = 'Install the sf-secret-inject Claude Code skill to ~/.claude/skills/.'

  public async run(): Promise<{installed: string}> {
    const pkgRoot = join(fileURLToPath(import.meta.url), '..', '..', '..', '..')
    const skillSrc = join(pkgRoot, 'skill', 'SKILL.md')

    if (!existsSync(skillSrc)) {
      this.error(`Skill source not found at ${skillSrc} — is the package installed correctly?`)
    }

    await mkdir(SKILL_DEST, {recursive: true})
    const dest = join(SKILL_DEST, 'SKILL.md')
    await copyFile(skillSrc, dest)

    this.log(`Skill installed to ${dest}`)
    this.log('Restart Claude Code (or reload skills) to activate.')

    return {installed: dest}
  }
}
