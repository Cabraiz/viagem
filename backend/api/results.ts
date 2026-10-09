import { getDatabase } from '../lib/database.ts';
import { handleResults, type ResultsDatabase } from '../lib/results.ts';

// POST /api/results (room server, signed) and GET /api/results/:runId (public, via rewrite).
export default {
  fetch(request: Request) {
    return handleResults(request, {
      database: () => getDatabase() as unknown as ResultsDatabase,
      secret: process.env.RESULTS_SECRET,
    });
  },
};
