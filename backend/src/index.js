import 'dotenv/config';
import { createServer } from './gateway/server.js';

const port = Number(process.env.PORT || 5000);
const { app } = createServer();

app.listen(port, () => {
  console.log(`[SERVER] Cross-Border Payment API running on port ${port}`);
});
