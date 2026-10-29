// Runs once when the server starts (not during the build).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production" || process.env.ALLOW_LOCAL_PRODUCTION === "true") return;
  const { productionProblems } = await import("./lib/config");
  const problems = productionProblems();
  if (problems.length) {
    console.error(`Refusing to start:\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
}
