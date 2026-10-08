import { pathToFileURL } from 'node:url';
import { createBitvavoAccountReader } from '../lib/bitvavo-account-readonly.js';

const help = `Odczyt salda Bitvavo — READ ONLY.
Uruchom w terminalu Ubuntu/WSL: npm run bitvavo-balance
Klucz API i sekret podaj w ukrytych polach terminala.
Użyj klucza tylko do odczytu; wyłącz Trade i Withdraw.
Nie przekazuj sekretów w argumentach, plikach ani na czacie.
Saldo pojawi się tylko w tym terminalu. Nie przesyłaj jego zdjęcia z danymi konta.
Program nie potwierdza uprawnień klucza ani gotowości do handlu.
`;

// Raw mode prevents the terminal from echoing credentials or storing readline history.
export function readHidden(label, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve, reject) => {
    if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
      reject(new Error('TERMINAL_REQUIRED'));
      return;
    }
    let value = '';
    let finished = false;
    const wasRaw = input.isRaw === true;
    const wasFlowing = input.readableFlowing === true;
    const cleanup = () => {
      input.off('data', onData);
      input.off('end', onCancel);
      input.off('close', onCancel);
      input.off('error', onCancel);
      process.off('SIGINT', onCancel);
      process.off('SIGTERM', onCancel);
      input.setRawMode(wasRaw);
      if (!wasFlowing) input.pause();
    };
    const finish = (error) => {
      if (finished) return;
      finished = true;
      const result = value;
      value = '';
      try { cleanup(); output.write('\n'); } catch { error = new Error('TERMINAL_ERROR'); }
      if (error) reject(error);
      else resolve(result);
    };
    const onCancel = () => finish(new Error('INPUT_CANCELLED'));
    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      // Reject multiline paste: never interpret pasted material as a second prompt.
      if (/[\r\n]/.test(text.replace(/\r\n$|[\r\n]$/, ''))) {
        onCancel();
        return;
      }
      for (const char of text) {
        if (char === '\r' || char === '\n') { finish(); return; }
        if (char === '\u0003' || char === '\u0004') { onCancel(); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (/^[\x21-\x7e]$/.test(char) && value.length < 512) value += char;
        else { onCancel(); return; }
      }
    };
    try {
      input.setRawMode(true);
      input.on('data', onData);
      input.once('end', onCancel);
      input.once('close', onCancel);
      input.once('error', onCancel);
      process.once('SIGINT', onCancel);
      process.once('SIGTERM', onCancel);
      output.write(label);
      input.resume();
    } catch { finish(new Error('TERMINAL_ERROR')); }
  });
}

function renderBalances(rows) {
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error('INVALID_BALANCE');
  const seen = new Set();
  const validated = rows.map((row) => {
    if (!row || typeof row.symbol !== 'string' || !/^[A-Z0-9]{1,32}$/.test(row.symbol) || seen.has(row.symbol)) throw new Error('INVALID_BALANCE');
    seen.add(row.symbol);
    for (const field of ['available', 'inOrder']) {
      if (typeof row[field] !== 'string' || row[field].length > 64 || !/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(row[field])) throw new Error('INVALID_BALANCE');
    }
    return `${row.symbol}\t${row.available}\t${row.inOrder}`;
  });
  return validated.length ? `Waluta\tDostępne\tW zleceniach\n${validated.join('\n')}\n` : 'Połączenie poprawne: API zwróciło pustą listę sald.\n';
}

export async function runBalanceCli({
  argv = process.argv.slice(2), input = process.stdin, output = process.stdout,
  errorOutput = process.stderr, platform = process.platform,
  prompt = readHidden, createReader = createBitvavoAccountReader,
} = {}) {
  if (argv.length === 1 && argv[0] === '--help') { output.write(help); return 0; }
  if (argv.length) { errorOutput.write('Nieobsługiwane argumenty. Użyj --help. Nie podawaj kluczy w poleceniu.\n'); return 1; }
  if (platform !== 'linux' || !input.isTTY || !output.isTTY || !errorOutput.isTTY) {
    errorOutput.write('Wymagany interaktywny terminal Linux (Ubuntu/WSL), bez przekierowania wejścia i wyjścia.\n');
    return 1;
  }
  let apiKey = '';
  let apiSecret = '';
  try {
    output.write(help);
    apiKey = await prompt('Klucz API (ukryty): ', { input, output });
    apiSecret = await prompt('Sekret API (ukryty): ', { input, output });
    if (![apiKey, apiSecret].every((v) => typeof v === 'string' && /^[\x21-\x7e]{1,512}$/.test(v))) throw new Error('INVALID_CREDENTIALS');
    const reader = createReader({ enabled: true, apiKey, apiSecret });
    apiKey = ''; apiSecret = '';
    const rendered = renderBalances(await reader.getBalance());
    output.write(`\nREAD ONLY — odczyt zakończony. Handel nie został uruchomiony.\n${rendered}`);
    return 0;
  } catch {
    errorOutput.write('Odczyt nie powiódł się lub został anulowany. Sprawdź klucz, uprawnienia odczytu, ograniczenie IP i połączenie. Nie wysłano zlecenia.\n');
    return 1;
  } finally { apiKey = ''; apiSecret = ''; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runBalanceCli();
}
