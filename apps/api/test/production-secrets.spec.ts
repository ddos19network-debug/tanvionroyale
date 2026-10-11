import {
  findUnsafeProductionSecrets,
  validateProductionSecrets,
} from "../src/config/production-secrets";

const REAL_SECRET = "a".repeat(64);

describe("validateProductionSecrets (unit)", () => {
  it("passes when every production secret is configured with a real value", () => {
    const failures = findUnsafeProductionSecrets({
      DATABASE_URL: "postgresql://user:pass@host:5432/db",
      JWT_SECRET: REAL_SECRET,
      ENCRYPTION_KEY: "b".repeat(64),
    });
    expect(failures).toEqual([]);
  });

  it("flags a missing DATABASE_URL", () => {
    const failures = findUnsafeProductionSecrets({
      JWT_SECRET: REAL_SECRET,
      ENCRYPTION_KEY: "b".repeat(64),
    });
    expect(failures).toHaveLength(1);
    expect(failures[0].name).toBe("DATABASE_URL");
  });

  it("flags the source-known development JWT fallback as a placeholder", () => {
    const failures = findUnsafeProductionSecrets({
      DATABASE_URL: "postgresql://user:pass@host:5432/db",
      JWT_SECRET: "dev-only-insecure-secret-change-me",
      ENCRYPTION_KEY: "b".repeat(64),
    });
    expect(failures).toHaveLength(1);
    expect(failures[0].name).toBe("JWT_SECRET");
    expect(failures[0].reason).toMatch(/placeholder/);
  });

  it("flags every known development placeholder value", () => {
    for (const placeholder of [
      "dev-only-encryption-key-change-me",
      "change-me-32-byte-encryption-key",
      "change-me-to-a-64-char-random-string-in-production",
    ]) {
      const failures = findUnsafeProductionSecrets({
        DATABASE_URL: "postgresql://user:pass@host:5432/db",
        JWT_SECRET: REAL_SECRET,
        ENCRYPTION_KEY: placeholder,
      });
      expect(failures).toHaveLength(1);
      expect(failures[0].name).toBe("ENCRYPTION_KEY");
    }
  });

  it("treats whitespace-only secrets as missing", () => {
    const failures = findUnsafeProductionSecrets({
      DATABASE_URL: "postgresql://user:pass@host:5432/db",
      JWT_SECRET: "   ",
      ENCRYPTION_KEY: "b".repeat(64),
    });
    expect(failures).toHaveLength(1);
    expect(failures[0].name).toBe("JWT_SECRET");
  });

  it("rejects secrets shorter than the entropy floor", () => {
    const failures = findUnsafeProductionSecrets({
      DATABASE_URL: "postgresql://user:pass@host:5432/db",
      JWT_SECRET: "too-short",
      ENCRYPTION_KEY: "b".repeat(64),
    });
    expect(failures).toHaveLength(1);
    expect(failures[0].reason).toMatch(/shorter/);
  });

  it("throws a hard error listing every unsafe secret in production", () => {
    expect(() =>
      validateProductionSecrets({
        NODE_ENV: "production",
        DATABASE_URL: "",
        JWT_SECRET: "dev-only-insecure-secret-change-me",
        ENCRYPTION_KEY: "short",
      }),
    ).toThrow(/Refusing to start in production/);
  });

  it("is a no-op outside production (local development keeps working)", () => {
    expect(() =>
      validateProductionSecrets({
        NODE_ENV: "development",
        DATABASE_URL: "",
        JWT_SECRET: "",
        ENCRYPTION_KEY: "",
      }),
    ).not.toThrow();
  });
});
