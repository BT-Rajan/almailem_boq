import mysql, { type Pool, type PoolConnection, type PoolOptions } from 'mysql2/promise';

/** The connection pool type, re-exported so application code never imports the driver itself. */
export type DbPool = Pool;

/** A pool, or a connection checked out of one (for transactions). Repositories take either. */
export type Db = Pool | PoolConnection;

/** Strict mode so MariaDB rejects bad data instead of silently truncating it (money!). */
const SESSION_SQL =
  "SET time_zone = '+00:00', sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'";

export function connectionOptions(url: string): PoolOptions {
  const u = new URL(url);
  if (u.protocol !== 'mysql:' && u.protocol !== 'mariadb:') {
    throw new Error('Database URL must start with mysql:// or mariadb://');
  }
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    ...(u.pathname.length > 1 && { database: decodeURIComponent(u.pathname.slice(1)) }),
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: ['DATE'], // DATE columns stay 'YYYY-MM-DD' strings; DATETIME become UTC Dates
    supportBigNumbers: true, // BIGINT becomes a number when safe, a string when not
    bigNumberStrings: false,
  };
}

export function createPool(url: string, connectionLimit = 10): Pool {
  const pool = mysql.createPool({ ...connectionOptions(url), connectionLimit });
  pool.pool.on('connection', (conn) => {
    conn.query(SESSION_SQL);
  });
  return pool;
}
