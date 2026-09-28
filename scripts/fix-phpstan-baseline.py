import re

p = "backend-laravel/phpstan-baseline.neon"
lines = open(p).read().split("\n")

stale_markers = [
    r"DomainController\:\:transition\(\) return type has no value type",
    r"between ''invalid_state''",
]

# Parse "\t\t-" blocks, each ending at the next blank line (inclusive of the
# blank separator).
blocks = []
i = 0
n = len(lines)
while i < n:
    if lines[i] == "\t\t-":
        j = i + 1
        while j < n and lines[j] != "":
            j += 1
        end = min(j + 1, n)  # include the blank line
        blocks.append((i, end))
        i = end
    else:
        i += 1

drop = set()
clone_source = None
for start, end in blocks:
    text = "\n".join(lines[start:end])
    stale = ("booleanAnd.rightAlwaysTrue" in text and "VerifyDomainDnsJob" in text) or (
        any(m in text for m in stale_markers) and "DomainController" in text
    )
    if stale:
        drop.update(range(start, end))
    if r"DomainController\:\:store\(\) has no return type" in text:
        clone_source = (start, end)

insert_at = None
clone = None
if clone_source:
    start, end = clone_source
    clone = [
        ln.replace(r"DomainController\:\:store\(\)", r"DomainController\:\:activity\(\)")
        for ln in lines[start:end]
    ]
    insert_at = end

out = []
for k in range(n):
    if k not in drop:
        out.append(lines[k])
    if insert_at is not None and k == insert_at - 1 and not (k in drop):
        # insert the clone right after the store() block (before its blank sep
        # is lost); the block slice already ends with the blank line, so append
        # the clone and it will carry its own separator.
        out.extend(clone)

open(p, "w").write("\n".join(out))
print("dropped:", len(drop), "cloned:", clone is not None)
