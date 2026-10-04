/** App-wide singletons. Exactly one API client (and, from T04, one playback engine). */
import { createApiClient } from '../api/client';

export const api = createApiClient();
