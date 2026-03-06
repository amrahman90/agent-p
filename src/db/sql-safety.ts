export interface ParameterizedQuery {
  readonly text: string;
  readonly params: readonly unknown[];
}

const stripQuotedContent = (sql: string): string => {
  let result = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];

    if (current === "'" && !inDoubleQuote) {
      if (inSingleQuote && next === "'") {
        index += 1;
        continue;
      }

      inSingleQuote = !inSingleQuote;
      result += " ";
      continue;
    }

    if (current === '"' && !inSingleQuote) {
      if (inDoubleQuote && next === '"') {
        index += 1;
        continue;
      }

      inDoubleQuote = !inDoubleQuote;
      result += " ";
      continue;
    }

    result += inSingleQuote || inDoubleQuote ? " " : current;
  }

  return result;
};

const countPlaceholders = (sql: string): number => {
  return [...sql].filter((character) => character === "?").length;
};

export const assertSafeSingleStatement = (
  sqlText: string,
  params?: readonly unknown[],
): void => {
  const normalizedSql = sqlText.trim();
  if (normalizedSql.length === 0) {
    throw new Error("SQL statement must be a non-empty string");
  }

  if (normalizedSql.includes("\0")) {
    throw new Error("SQL statement contains invalid null byte");
  }

  const strippedSql = stripQuotedContent(normalizedSql);

  if (/--|\/\*/.test(strippedSql)) {
    throw new Error("SQL comments are not allowed in query statements");
  }

  if (/;(?!\s*$)/.test(strippedSql)) {
    throw new Error("Multiple SQL statements are not allowed");
  }

  const placeholderCount = countPlaceholders(strippedSql);
  if (!params && placeholderCount > 0) {
    throw new Error("SQL parameters are required for placeholder bindings");
  }

  if (params && placeholderCount !== params.length) {
    throw new Error(
      `SQL placeholder count (${placeholderCount}) does not match parameter count (${params.length})`,
    );
  }
};

export const sqlQuery = (
  strings: TemplateStringsArray,
  ...values: readonly unknown[]
): ParameterizedQuery => {
  if (strings.length !== values.length + 1) {
    throw new Error("Invalid SQL template usage");
  }

  let text = "";
  for (let index = 0; index < strings.length; index += 1) {
    text += strings[index];
    if (index < values.length) {
      text += "?";
    }
  }

  assertSafeSingleStatement(text, values);

  return {
    text,
    params: values,
  };
};
