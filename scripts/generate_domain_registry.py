import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import tempfile

LABEL = r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
HOSTNAME = re.compile(rf'{LABEL}(?:\.{LABEL})+')


def validate_hostname(value):
    if not isinstance(value, str) or len(value) > 253 or not HOSTNAME.fullmatch(value):
        raise ValueError(f'Invalid hostname: {value}')
    return value


def read_names(path):
    return [line.strip().lower()
            for line in path.read_text(encoding='utf-8').splitlines()
            if line.strip()]


def discover_domains(source):
    roots = read_names(source / 'domains.list')
    if not roots:
        raise ValueError('Root-domain list is empty; refusing an empty registry')
    domains = set()
    for root in roots:
        domains.add(validate_hostname(root))
        for subdomain in read_names(source / 'domains' / f'{root}.subdomains'):
            domains.add(validate_hostname(f'{subdomain}.{root}'))
    return {'domains': sorted(domains)}


def registry_domains(registry):
    if not isinstance(registry, dict) or not isinstance(registry.get('domains'), list):
        raise ValueError('Invalid registry structure')
    values = registry['domains']
    for domain in values:
        validate_hostname(domain)
    if not values or values != sorted(set(values)):
        raise ValueError('Registry must contain sorted, unique domains')
    return set(values)


def write_registry(destination, registry):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode='w', encoding='utf-8', dir=destination.parent,
            prefix=f'.{destination.name}.', suffix='.tmp', delete=False
        ) as handle:
            temporary = Path(handle.name)
            json.dump(registry, handle, indent=2)
            handle.write('\n')
            handle.flush()
            os.fsync(handle.fileno())
        temporary.chmod(0o640)
        os.replace(temporary, destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def read_history(history):
    if not history.exists():
        return None
    previous = set()
    last = None
    for line in history.read_text(encoding='utf-8').splitlines():
        if not line:
            raise ValueError('History contains an incomplete or empty record')
        record = json.loads(line)
        current = registry_domains(record)
        if (record.get('version') != 1 or
                record.get('added') != sorted(current - previous) or
                record.get('removed') != sorted(previous - current)):
            raise ValueError('History change chain is inconsistent')
        previous = current
        last = record
    return last


def append_history(history, record):
    # Journal is append-only. A partial/corrupt line stops subsequent updates.
    fd = os.open(history, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o640)
    with os.fdopen(fd, 'a', encoding='utf-8') as handle:
        handle.write(json.dumps(record, separators=(',', ':')) + '\n')
        handle.flush()
        os.fsync(handle.fileno())


def update_registry(source, destination, history):
    if len({source.resolve(), destination.resolve(), history.resolve()}) != 3:
        raise ValueError('Source, output and history must use distinct paths')
    for path in (destination, history):
        if source.resolve() in path.resolve().parents:
            raise ValueError('Output and history must stay outside DirectAdmin source files')
    lock_path = destination.with_name(destination.name + '.lock')
    if history.resolve() == lock_path.resolve():
        raise ValueError('History must not use the registry lock path')
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o640)
    with os.fdopen(fd, 'a') as lock:
        # A scheduled run and a manual run cannot update these files together.
        fcntl.flock(lock, fcntl.LOCK_EX)
        registry = discover_domains(source)
        current = registry_domains(registry)
        existing = None
        if destination.exists():
            existing = json.loads(destination.read_text(encoding='utf-8'))
            registry_domains(existing)
        last = read_history(history)
        previous = set(last['domains']) if last else set()
        changed = last is None or previous != current
        if changed:
            record = {
                'version': 1,
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'added': sorted(current - previous),
                'removed': sorted(previous - current),
                'domains': registry['domains'],
            }
            # Durable discovery history comes before publication. If publication
            # fails, the next successful run uses this snapshot without appending
            # the same change again, then repairs the current registry.
            append_history(history, record)
        published = existing != registry
        if published:
            write_registry(destination, registry)
        return {'history_added': changed, 'registry_updated': published,
                'domain_count': len(current)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--history', type=Path)
    args = parser.parse_args()
    if args.history and not args.output:
        parser.error('--history requires --output')
    if args.output:
        history = args.history or args.output.with_name(args.output.stem + '.history.jsonl')
        result = update_registry(args.source, args.output, history)
        print(json.dumps({'output': str(args.output), 'history': str(history), **result}))
    else:
        print(json.dumps(discover_domains(args.source), indent=2))


if __name__ == '__main__':
    main()
