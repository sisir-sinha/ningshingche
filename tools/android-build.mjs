#!/usr/bin/env node
/**
 * Build the Kotlin core of the Android reference (`android/core`).
 *
 * The Android *app* module needs the Android SDK and an emulator, neither of
 * which exists on a build agent like this one — so it is source-only, and its
 * Gradle files say so. The core, however, is plain Kotlin/JVM: it compiles and
 * runs anywhere a JDK does, which is exactly why the reference is split that
 * way. This script is what makes `npm run e2e:android` able to prove the
 * Android data layer against the live project in a run of `npm test`-shaped
 * speed rather than an emulator boot.
 *
 * It downloads the Kotlin compiler and the two serialization jars into
 * `~/.cache/mekholi-android` on first use and then leaves them alone. Nothing
 * lands in the repository: `android/core/build/**` is generated and ignored.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(homedir(), '.cache', 'mekholi-android')

const KOTLIN_VERSION = '2.0.21'
const SERIALIZATION_VERSION = '1.7.3'
const MAVEN = 'https://repo1.maven.org/maven2'

const ARTIFACTS = [
  {
    path: `${MAVEN}/org/jetbrains/kotlinx/kotlinx-serialization-json-jvm/${SERIALIZATION_VERSION}/kotlinx-serialization-json-jvm-${SERIALIZATION_VERSION}.jar`,
    file: `kotlinx-serialization-json-jvm-${SERIALIZATION_VERSION}.jar`,
  },
  {
    path: `${MAVEN}/org/jetbrains/kotlinx/kotlinx-serialization-core-jvm/${SERIALIZATION_VERSION}/kotlinx-serialization-core-jvm-${SERIALIZATION_VERSION}.jar`,
    file: `kotlinx-serialization-core-jvm-${SERIALIZATION_VERSION}.jar`,
  },
  {
    path: `${MAVEN}/org/jetbrains/kotlin/kotlin-serialization-compiler-plugin/${KOTLIN_VERSION}/kotlin-serialization-compiler-plugin-${KOTLIN_VERSION}.jar`,
    file: `kotlin-serialization-compiler-plugin-${KOTLIN_VERSION}.jar`,
  },
]

export const KOTLINC = join(CACHE, 'kotlinc', 'bin', 'kotlinc')
export const CORE_JAR = join(ROOT, 'android', 'core', 'build', 'mekholi-core.jar')

/**
 * The runtime classpath a compiled core needs.
 *
 * The jar is assembled with the JDK's `jar`, not `kotlinc -include-runtime`
 * (which binds the runtime into an application jar and only works when
 * compiling and linking in one step), so the Kotlin standard library has to be
 * named explicitly — the copy that ships inside the compiler distribution, so
 * the version always matches the compiler that produced the classes.
 */
export function runtimeClasspath() {
  return [
    CORE_JAR,
    join(CACHE, 'kotlinc', 'lib', 'kotlin-stdlib.jar'),
    join(CACHE, `kotlinx-serialization-json-jvm-${SERIALIZATION_VERSION}.jar`),
    join(CACHE, `kotlinx-serialization-core-jvm-${SERIALIZATION_VERSION}.jar`),
  ].join(':')
}

/**
 * The JDK's `jar` tool.
 *
 * Found next to `java` rather than assumed to be on `PATH`: on a machine where
 * the JRE is what is installed as `/usr/bin/java`, the JDK lives beside it and
 * `jar` is not linked anywhere. Resolving the symlink gets both from the same
 * installation, so the jar and the JVM that runs it are the same version.
 */
export function jarTool() {
  const candidates = []
  if (process.env.JAVA_HOME) candidates.push(join(process.env.JAVA_HOME, 'bin', 'jar'))
  try {
    const java = realpathSync(execFileSync('which', ['java'], { encoding: 'utf8' }).trim())
    candidates.push(join(dirname(java), 'jar'))
  } catch {
    // No `java` on PATH at all: the error below says what to install.
  }
  candidates.push('/usr/bin/jar', '/usr/local/bin/jar')
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) {
    throw new Error(
      'no `jar` tool found — install a JDK (JAVA_HOME or java on PATH) to package the core'
    )
  }
  return found
}

async function download(url, file) {
  const target = join(CACHE, file)
  if (existsSync(target) && statSync(target).size > 0) return target
  process.stdout.write(`  fetching ${file}\n`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`could not fetch ${url} (HTTP ${response.status})`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target))
  return target
}

/** Everything the compile needs, downloading on first use. */
export async function ensureToolchain() {
  mkdirSync(CACHE, { recursive: true })

  if (!existsSync(KOTLINC)) {
    const zip = await download(
      `https://github.com/JetBrains/kotlin/releases/download/v${KOTLIN_VERSION}/kotlin-compiler-${KOTLIN_VERSION}.zip`,
      `kotlin-compiler-${KOTLIN_VERSION}.zip`
    )
    process.stdout.write('  unpacking the Kotlin compiler\n')
    execFileSync('unzip', ['-q', '-o', zip, '-d', CACHE])
  }

  for (const artifact of ARTIFACTS) await download(artifact.path, artifact.file)

  return {
    kotlinc: KOTLINC,
    plugin: join(CACHE, `kotlin-serialization-compiler-plugin-${KOTLIN_VERSION}.jar`),
    classpath: [
      join(CACHE, `kotlinx-serialization-json-jvm-${SERIALIZATION_VERSION}.jar`),
      join(CACHE, `kotlinx-serialization-core-jvm-${SERIALIZATION_VERSION}.jar`),
    ].join(':'),
  }
}

function sourcesUnder(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...sourcesUnder(path))
    else if (entry.name.endsWith('.kt')) found.push(path)
  }
  return found
}

/** True when the jar is newer than every source it was built from. */
export function isUpToDate() {
  if (!existsSync(CORE_JAR)) return false
  const built = statSync(CORE_JAR).mtimeMs
  const sources = sourcesUnder(join(ROOT, 'android', 'core', 'src', 'main', 'kotlin'))
  return sources.every((file) => statSync(file).mtimeMs <= built)
}

export async function buildCore({ force = false } = {}) {
  if (!force && isUpToDate()) return { built: false, reason: 'up to date' }

  const { kotlinc, plugin, classpath } = await ensureToolchain()
  const sources = sourcesUnder(join(ROOT, 'android', 'core', 'src', 'main', 'kotlin'))
  const outDir = join(ROOT, 'android', 'core', 'build', 'classes')

  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  execFileSync(
    kotlinc,
    [
      '-Xplugin=' + plugin,
      '-cp',
      classpath,
      // The compiler prints its version banner on every run; it is noise here.
      '-nowarn',
      '-d',
      outDir,
      ...sources,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  )

  mkdirSync(dirname(CORE_JAR), { recursive: true })
  execFileSync(jarTool(), ['cf', CORE_JAR, '-C', outDir, '.'], { stdio: 'inherit' })

  return { built: true, sources: sources.length }
}

/**
 * Compile and run the core's tests (`android/core/src/test`).
 *
 * The test source file is the whole framework: it prints its checks and exits
 * non-zero, so `npm run test:android` needs nothing but the JDK and the
 * compiler this script already downloads. It runs against the built jar rather
 * than the classes directory, which is a small extra guarantee — the thing the
 * tests pass on is the thing that ships.
 */
export async function testCore({ force = false } = {}) {
  await buildCore({ force })
  const { kotlinc, plugin, classpath } = await ensureToolchain()

  const sources = sourcesUnder(join(ROOT, 'android', 'core', 'src', 'test', 'kotlin'))
  if (sources.length === 0) return { ran: false, reason: 'no test sources' }

  const outDir = join(ROOT, 'android', 'core', 'build', 'test-classes')
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  execFileSync(
    kotlinc,
    [
      '-Xplugin=' + plugin,
      '-cp',
      `${classpath}:${CORE_JAR}`,
      '-nowarn',
      '-d',
      outDir,
      ...sources,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  )

  // The entry point is the test file's top-level `main`: `CoreTest.kt` compiles
  // to `CoreTestKt`.
  const result = spawnSync('java', ['-cp', `${runtimeClasspath()}:${outDir}`, 'dev.mekholi.core.CoreTestKt'], {
    stdio: 'inherit',
  })
  return { ran: true, code: result.status ?? 1 }
}

// `node tools/android-build.mjs` — the npm script, and the message a developer
// sees when the Android side is not set up yet.
if (process.argv[1] && process.argv[1].endsWith('android-build.mjs')) {
  const result = await buildCore({ force: process.argv.includes('--force') })
  console.log(
    result.built
      ? `built ${CORE_JAR} from ${result.sources} Kotlin file(s)`
      : `core already built (${result.reason}) — use --force to rebuild`
  )
}
