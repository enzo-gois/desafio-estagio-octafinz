import { z } from 'zod';

// Zod compiles object parsers with `new Function` when eval is allowed, probing for it once.
// The CSP served by nginx (default-src 'self', no 'unsafe-eval') blocks the probe: Zod falls
// back to its interpreted parser, but the browser still logs a CSP violation. jitless skips the
// probe and goes straight to that same parser.
// Zod reads this when each schema is built, at module load: main.tsx imports this file first.
z.config({ jitless: true });
