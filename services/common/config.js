// Environment configuration shared by every service.
function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing required environment variable ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT || 8080),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'cap',
    user: process.env.DB_USER || 'cap_app',
    password: process.env.DB_PASSWORD || '',
    max: Number(process.env.DB_POOL_MAX || 10),
  },
  jwtSecret: () => required('JWT_SECRET'),
  encryptionKey: () => required('CAP_ENCRYPTION_KEY'),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://cap.bupasec.com',
  evaluatorUrl: process.env.EVALUATOR_URL || 'http://cap-evaluator:8080',
  sessionHours: Number(process.env.SESSION_HOURS || 12),
};
