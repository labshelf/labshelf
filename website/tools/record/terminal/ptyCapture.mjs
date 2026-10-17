// Runs a command in a real pty, types scheduled keys into it and records the output bytes with their timings.
// Node has no pty, so a small inline Python harness (run with -I) does the pty.fork and the timing.
import { spawn } from "node:child_process";

const HARNESS = String.raw`
import base64, fcntl, json, os, pty, select, signal, struct, sys, termios, time
job = json.loads(sys.argv[1])
pid, fd = pty.fork()
if pid == 0:
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", job["rows"], job["cols"], 0, 0))
    os.chdir(job["cwd"])
    os.execve(job["argv"][0], job["argv"], job["env"])
start = time.monotonic()
keys = sorted(job["keys"], key=lambda k: k["at"])
chunks = []
alive = True
while alive:
    now = time.monotonic() - start
    while keys and keys[0]["at"] <= now:
        os.write(fd, keys.pop(0)["data"].encode())
    if now > job["timeout"]:
        os.kill(pid, signal.SIGKILL)
        break
    wait = min(0.05, max(keys[0]["at"] - now, 0)) if keys else 0.05
    ready, _, _ = select.select([fd], [], [], wait)
    if ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            data = b""
        if not data:
            alive = False
        else:
            chunks.append({"t": time.monotonic() - start, "data": base64.b64encode(data).decode()})
os.waitpid(pid, 0)
print(json.dumps(chunks))
`;

/**
 * Runs `argv` in a pty of `cols` x `rows` and records what it prints.
 * @param {{ argv: string[], cwd: string, env: Record<string, string>, cols: number, rows: number,
 *   keys?: { at: number, data: string }[], timeout?: number }} job key times and timeout in seconds
 * @returns {Promise<{ t: number, data: Buffer }[]>} output chunks, times in seconds from the start
 */
export function capturePty({ keys = [], timeout = 30, ...job }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ ...job, keys, timeout });
    const child = spawn("python3", ["-I", "-c", HARNESS, payload], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`pty harness for ${job.argv.join(" ")} exited ${code}: ${stderr}`));
      resolve(JSON.parse(stdout).map(({ t, data }) => ({ t, data: Buffer.from(data, "base64") })));
    });
  });
}
