# link-preview-safe

Fetches Open Graph tags for a user-supplied URL after
[hostfence](https://github.com/hon900/hostfence) rejects internal targets.
Redirects are not followed; each hop must be asserted separately.

```js
import { preview } from "link-preview-safe";

const card = await preview("https://example.com");
```

Depends on `github:hon900/hostfence#v1.2.0`.
