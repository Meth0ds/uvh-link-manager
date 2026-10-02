import { assessPassword, passwordBands, passwordStrengthLabel } from "./password-policy";

describe("Generated password policy presentation", () => {
  it("marks accepted phrases strong and keeps the meter bounded", () => {
    const assessment = assessPassword("Órbita-Mango-Cobre-47!");
    expect(assessment.acceptable).toBeTrue();
    expect(passwordStrengthLabel(assessment.score)).toBe("Fuerte");
    expect(assessment.score).toBeLessThanOrEqual(100);
  });

  for (const password of ["Orbit-Login-Copper-73!", "Órbita-Contraseña-Cobre-47!", "Orbit-aaaa-Copper-73!", "Orbit-1234-Copper-73!"]) {
    it(`does not praise a rejected dictionary word or pattern: ${password}`, () => {
      const assessment = assessPassword(password);
      expect(assessment.acceptable).toBeFalse();
      expect(assessment.score).toBeLessThan(passwordBands.fair);
      expect(passwordStrengthLabel(assessment.score)).toBe("Débil");
    });
  }

  it("rejects personal data and recomputes with the current identity", () => {
    expect(assessPassword("Órbita-Mango-Cobre-47!", "Ana", "ana@example.test").acceptable).toBeTrue();
    const current = assessPassword("Órbita-Mango-Cobre-47!", "Órbita", "ana@example.test");
    expect(current.personal).toBeTrue();
    expect(current.acceptable).toBeFalse();
    expect(current.feedback).toContain("nombre");
    expect(current.score).toBeLessThan(passwordBands.fair);
  });

  it("counts Unicode code points rather than UTF16 units for the minimum", () => {
    const assessment = assessPassword("🌙🌟🌍🌈🔥🌊🍀🍁🌻");
    expect(assessment.acceptable).toBeFalse();
    expect(assessment.feedback).toContain("mínimo");
  });

  it("explains the maximum length without positive feedback", () => {
    const assessment = assessPassword("orbit-copper-magnolia-73!".repeat(4));
    expect(assessment.acceptable).toBeFalse();
    expect(assessment.feedback).toContain("72");
    expect(assessment.feedback).not.toContain("Buena base");
  });
  it("rejects a Unicode phrase above the backend byte limit", () => {
    const password = "Órbita-Mango-Cobre-47!🌙🌟🌍🌈🔥🌊🍀🍁🌻🌞🌧🌨🌩🌪🌫🌬🌭🌮";
    expect([...password].length).toBeLessThan(72);
    expect(new TextEncoder().encode(password).length).toBeGreaterThan(72);
    const assessment = assessPassword(password);
    expect(assessment.acceptable).toBeFalse();
    expect(assessment.score).toBeLessThan(passwordBands.fair);
    expect(assessment.feedback).toContain("Acórtala");
  });

});
