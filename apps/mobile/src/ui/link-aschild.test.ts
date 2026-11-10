import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// expo-router's <Link asChild> passes its child through <Slot>, which throws in dev ("You are passing an array of
// styles to a child of <Slot>") and drops the styles in release. There are no render tests, so guard the source:
// the element right after `<Link … asChild>` must not take an array `style={[…]}` (use StyleSheet.flatten).
const ROOTS = [join(__dirname, ".."), join(__dirname, "..", "..", "app")];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

/** The opening tag of the first JSX element after each `<Link … asChild>`. */
function asChildTargets(source: string): string[] {
  const out: string[] = [];
  const link = /<Link\b[^>]*\basChild\b[^>]*>/g;
  for (let m = link.exec(source); m; m = link.exec(source)) {
    const rest = source.slice(m.index + m[0].length);
    const child = /<[A-Za-z][\s\S]*?>/.exec(rest);
    if (child) out.push(child[0]);
  }
  return out;
}

describe("Link asChild children", () => {
  it("finds the child tag", () => {
    expect(asChildTargets('<Link href="/x" asChild>\n  <Pressable style={[a, b]}>')).toEqual(["<Pressable style={[a, b]}>"]);
  });

  it("no child of <Link asChild> takes an array style", () => {
    const bad = ROOTS.flatMap(sources).flatMap((file) =>
      asChildTargets(readFileSync(file, "utf8"))
        .filter((tag) => /\bstyle=\{\s*\[/.test(tag))
        .map((tag) => `${file}: ${tag}`),
    );
    expect(bad).toEqual([]);
  });
});
