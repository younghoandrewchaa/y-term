/** Commands whose output is a plain `git branch` list: one local branch per line. */
export function isBranchListCommand(command: string | undefined): boolean {
  if (command === undefined) return false;
  const words = command.trim().split(/[ \t]+/);
  if (words[0] !== 'git') return false;
  let index = 1;
  if (words[index] === '--no-pager') index++;
  if (words[index++] !== 'branch') return false;
  const rest = words.slice(index).filter(Boolean);
  if (!rest.length || (rest.length === 1 && rest[0] === '--list')) return true;
  // `--merged` and `--no-merged` keep the same format and optionally take a commit.
  return (rest[0] === '--merged' || rest[0] === '--no-merged') && rest.length <= 2 && !rest[1]?.startsWith('-');
}

/** The branch on a `git branch` output line, unless it is checked out here (`*`) or in another worktree (`+`). */
export function parseBranchLine(text: string): string | undefined {
  const match = /^  (\S+)$/.exec(text.trimEnd());
  if (!match || match[1].startsWith('(') || match[1].startsWith('-')) return undefined;
  return match[1];
}
