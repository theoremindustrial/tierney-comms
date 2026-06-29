import express, { Request, Response, NextFunction } from 'express';
import healthRouter from './routes/health';
import authRouter from './routes/auth';
import syncRouter from './routes/sync';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(healthRouter);
app.use(authRouter);
app.use(syncRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
