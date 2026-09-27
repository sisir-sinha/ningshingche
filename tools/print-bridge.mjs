#!/usr/bin/env node
/**
 * The print bridge: the eight lines of socket code a browser is not allowed to
 * have.
 *
 * A LAN thermal printer listens on TCP 9100 and speaks raw ESC/POS. No browser
 * can open a TCP socket — not Chrome, not the Android WebView, not with any
 * permission — so a web POS physically cannot drive one on its own. Every
 * product that claims otherwise ships a helper exactly like this file.
 *
 * Run it on any always-on machine on the shop's network: the back-office PC, a
 * Raspberry Pi, the same laptop the till runs on. Then put its address into
 * Printer setup → Bridge URL.
 *
 *     node tools/print-bridge.mjs                 # listens on 0.0.0.0:3131
 *     node tools/print-bridge.mjs --port 4000
 *     node tools/print-bridge.mjs --allow https://shop.example.com
 *
 * The till POSTs the job as `application/octet-stream`:
 *
 *     POST /print?host=192.168.0.100&port=9100
 *
 * ── Deliberately not clever ───────────────────────────────────────────────
 * No dependencies, no queue, no spooler, no config file. It opens a socket,
 * writes the bytes, closes it, and answers 200 or an error the cashier can
 * read. A shop should be able to audit the whole thing in one sitting, because
 * it is the one piece of Mekholi that runs outside the browser sandbox.
 */

import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import { Socket } from 'node:net'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? fallback : (args[at + 1] ?? fallback)
}

const PORT = Number(flag('port', 3131))
const ALLOW = flag('allow', '*')
/** Refuse a job that is obviously not a receipt. 2 MB is a long one. */
const MAX_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 8000

/**
 * Send the bytes and resolve when the printer has taken them.
 *
 * `write` returning is not enough — it only means the kernel buffered them —
 * so the socket is ended and the close awaited. Without that, a job to a
 * printer that is powered off "succeeds" and the cashier prints it again.
 */
function sendToPrinter(host, port, payload) {
  return new Promise((resolve, reject) => {
    const socket = new Socket()
    let settled = false

    const fail = (message) => {
      if (settled) return
      settled = true
      socket.destroy()
      reject(new Error(message))
    }

    socket.setTimeout(TIMEOUT_MS)
    socket.once('timeout', () => fail(`${host}:${port} did not answer within ${TIMEOUT_MS} ms.`))
    socket.once('error', (error) => fail(`${host}:${port} — ${error.message}`))
    socket.once('close', () => {
      if (settled) return
      settled = true
      resolve()
    })

    socket.connect(port, host, () => {
      socket.write(payload, (error) => {
        if (error) fail(`${host}:${port} — ${error.message}`)
        else socket.end()
      })
    })
  })
}

const server = createServer((request, response) => {
  const cors = {
    'access-control-allow-origin': ALLOW,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors).end()
    return
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  // A GET is a human checking the bridge is alive, which is the first thing
  // anyone does when a receipt does not appear.
  if (request.method === 'GET') {
    response.writeHead(200, { ...cors, 'content-type': 'text/plain' })
    response.end(`Mekholi print bridge is running on port ${PORT}.\nPOST ESC/POS bytes to /print?host=<ip>&port=9100\n`)
    return
  }

  if (request.method !== 'POST') {
    response.writeHead(405, cors).end('Use POST.')
    return
  }

  const host = url.searchParams.get('host')
  const port = Number(url.searchParams.get('port') ?? 9100)
  if (!host) {
    response.writeHead(400, cors).end('Missing ?host=<printer ip>')
    return
  }

  const chunks = []
  let size = 0
  request.on('data', (chunk) => {
    size += chunk.length
    if (size > MAX_BYTES) {
      response.writeHead(413, cors).end('Job too large.')
      request.destroy()
      return
    }
    chunks.push(chunk)
  })

  request.on('end', () => {
    const payload = Buffer.concat(chunks)
    if (payload.length === 0) {
      response.writeHead(400, cors).end('Empty job.')
      return
    }

    sendToPrinter(host, port, payload).then(
      () => {
        console.log(`${new Date().toISOString()}  ${payload.length} bytes → ${host}:${port}`)
        response.writeHead(200, cors).end('printed')
      },
      (error) => {
        console.error(`${new Date().toISOString()}  FAILED → ${host}:${port}: ${error.message}`)
        response.writeHead(502, { ...cors, 'content-type': 'text/plain' }).end(error.message)
      }
    )
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mekholi print bridge listening on http://0.0.0.0:${PORT}`)
  console.log(`Allowing requests from: ${ALLOW}`)
  console.log('Put this machine\u2019s address into Printer setup \u2192 Bridge URL, e.g.')
  console.log(`  http://<this machine's ip>:${PORT}/print`)
})
