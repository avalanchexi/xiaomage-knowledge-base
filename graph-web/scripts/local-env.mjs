import { readFile } from "node:fs/promises";

export async function loadLocalEnv(filePath, targetEnv = process.env) {
  let contents;

  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return targetEnv;
    }
    throw error;
  }

  for (const line of contents.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }
    targetEnv[parsed.key] = parsed.value;
  }

  return targetEnv;
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const body = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trimStart() : trimmed;
  const equalsIndex = body.indexOf("=");
  if (equalsIndex <= 0) {
    return null;
  }

  const key = body.slice(0, equalsIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  return {
    key,
    value: parseEnvValue(body.slice(equalsIndex + 1).trim()),
  };
}

function parseEnvValue(value) {
  if (value.length < 2) {
    return value;
  }

  const quote = value[0];
  if ((quote !== "'" && quote !== '"') || value.at(-1) !== quote) {
    return value;
  }

  return value.slice(1, -1);
}
