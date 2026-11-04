const result = await new Deno.Command(Deno.execPath(), {
  args: [
    "bundle",
    "--platform=browser",
    "--packages=bundle",
    "--output",
    "public/app.js",
    "src/main.tsx",
  ],
  stdout: "inherit",
  stderr: "inherit",
}).output();

if (!result.success) {
  throw new Error(`Browser bundle failed with exit code ${result.code}.`);
}
