# Evidence

Screenshots and recordings referenced from pull requests.

This branch exists so those references keep working. A PR body links an image
by its raw URL pinned to a commit sha, and that URL only resolves while the
commit stays reachable from some ref. If the evidence lived on the PR's own
branch, merging or deleting that branch could garbage-collect the commit and
break every image in the PR — including after it has gone upstream, where
nobody here would notice.

So: **one branch, append-only, never deleted, never merged.**

## Layout

    evidence/<pr-branch-name>/...

One folder per PR, named for the branch that PR is opened from, so the link
between an image and the change it demonstrates needs no lookup.

## Adding evidence

1. Commit the files under `evidence/<pr-branch-name>/`.
2. Push to this branch. Never force-push: an existing PR's images are pinned to
   commits in this history.
3. Reference them pinned to the SHA you just pushed:

       https://raw.githubusercontent.com/<owner>/<repo>/<sha>/evidence/<folder>/<file>

   Pin the **sha**, not the branch name. A branch ref in a raw URL resolves
   against the latest commit, so the image silently changes as this branch
   grows; and a branch name containing a slash makes the ref/path split
   ambiguous and the URL 404s.
4. Check each URL returns HTTP 200 and an `image/*` content type before
   putting it in a PR body.

## Captures of real notifications

Anything showing a real message has the sender line replaced with `<REDACTED>`.
Nothing else in a frame is altered. Say so in the PR body, so a reader knows
the marker is ours and not something the device drew.
