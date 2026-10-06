import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

test('initial schema is repeatable and protects player identity and character ownership', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const sql = readFileSync(new URL('../backend/migrations/001-initial.sql', import.meta.url), 'utf8');
    db.exec(sql);
    db.exec(sql);
    assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations').get()!.n, 1);
    const insert = db.prepare('INSERT INTO players (id, username, display_name) VALUES (?, ?, ?)');
    insert.run('player-1', 'cabraiz', 'Cabraiz');
    assert.throws(() => insert.run('player-2', 'cabraiz', 'Duplicado'));
    assert.throws(() => insert.run('player-3', 'invalido!', 'Inválido'));
    const character = db.prepare('INSERT INTO characters (player_id, class_id, emblem_color) VALUES (?, ?, ?)');
    assert.throws(() => character.run('missing-player', 'cidadao-comum', 'lilas'));
    character.run('player-1', 'cidadao-comum', 'lilas');
    assert.equal(db.prepare('SELECT level FROM characters WHERE player_id = ?').get('player-1')!.level, 1);
  } finally { db.close(); }
});
