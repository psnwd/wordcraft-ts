export {}; // make this a module (top-level await)
// Start the Python API and the Next.js dev server together; Ctrl+C stops both.
const win = process.platform === "win32";
const python = win ? ".venv/Scripts/python.exe" : ".venv/bin/python";

if (!(await Bun.file(python).exists())) {
  console.error(`No virtualenv at .venv. Run:\n  python -m venv .venv\n  ${win ? ".venv/Scripts/pip" : ".venv/bin/pip"} install -r requirements.txt`);
  process.exit(1);
}

const procs = [Bun.spawn([python, "server.py"], { stdio: ["inherit", "inherit", "inherit"] }), Bun.spawn(["bunx", "next", "dev"], { stdio: ["inherit", "inherit", "inherit"] })];
const stopAll = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

// If either exits, take the other down too.
await Promise.race(procs.map((p) => p.exited));
stopAll();
