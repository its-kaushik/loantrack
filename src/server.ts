import app from './app.js';
import { config } from './config/index.js';

const server = app.listen(config.port, () => {
  console.log(`LoanTrack API running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

// Graceful shutdown
function shutdown() {
  console.log('Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default server;
