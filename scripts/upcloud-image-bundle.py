#!/usr/bin/env python3
"""Export Docker images by ID; verify all bytes and IDs before using them.

This transports artifacts. It does not approve security reports or production
promotion. Invoke from a clean, published checkout; keep bundles outside Git.
Import requires the manifest hash and source commit recorded on the sender.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def command(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def digest(file):
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def inspect(reference):
    result = json.loads(command('docker', 'image', 'inspect', '--platform', 'linux/amd64', reference))
    require(len(result) == 1, 'Expected exactly one local image')
    image = result[0]
    require(re.fullmatch(r'sha256:[0-9a-f]{64}', image['Id']), 'Invalid image ID')
    require(image['Os'] == 'linux' and image['Architecture'] == 'amd64',
            'Every release image must be linux/amd64')
    return image


def member_file(archive, name):
    require(not name.startswith('/') and '..' not in Path(name).parts,
            'Unsafe archive member path')
    member = archive.getmember(name)
    require(member.isfile(), 'Expected a regular image configuration file')
    return archive.extractfile(member)


def archive_id(file, image_id):
    # Inspect without extracting or executing anything. A tar with extra images
    # must fail before docker load, even if it contains the expected ID as well.
    with tarfile.open(file, 'r:') as archive:
        require(len([m for m in archive.getmembers() if m.name == 'manifest.json']) == 1,
                'Missing or duplicate Docker archive manifest')
        with member_file(archive, 'manifest.json') as stream:
            manifest = json.load(stream)
        require(isinstance(manifest, list) and len(manifest) == 1,
                'Each archive must contain exactly one image')
        with member_file(archive, manifest[0]['Config']) as stream:
            raw = stream.read()
        config_id = 'sha256:' + hashlib.sha256(raw).hexdigest()
        if config_id != image_id:
            # Docker's containerd image store identifies a selected image by
            # its OCI manifest; the classic store uses the configuration ID.
            # Validate the actual manifest and its link to that configuration.
            with member_file(archive, 'blobs/sha256/' + image_id[7:]) as stream:
                oci_raw = stream.read()
            require('sha256:' + hashlib.sha256(oci_raw).hexdigest() == image_id,
                    'OCI manifest digest mismatch')
            oci = json.loads(oci_raw)
            require(oci.get('config', {}).get('digest') == config_id,
                    'OCI manifest does not reference the expected configuration')
            with member_file(archive, 'index.json') as stream:
                index = json.load(stream)
            entries = index.get('manifests', [])
            require(isinstance(entries, list) and entries, 'Missing OCI index entries')
            actual = [e for e in entries if e.get('digest') == image_id]
            require(len(actual) == 1, 'Expected exactly one selected OCI image')
            for entry in entries:
                if entry.get('digest') == image_id:
                    continue
                require(entry.get('annotations', {}).get('io.containerd.manifest.subject') == image_id,
                        'OCI archive contains an unexpected image')
        config = json.loads(raw)
        require(config.get('os') == 'linux' and config.get('architecture') == 'amd64',
                'Image archive has the wrong platform')


def export(args):
    source = args.source.resolve()
    commit = command('git', 'rev-parse', 'HEAD', cwd=source)
    require(re.fullmatch(r'[0-9a-f]{40}', commit), 'Expected a full source SHA')
    require(not command('git', 'status', '--porcelain', cwd=source),
            'Source checkout must be clean')
    remote = command('git', 'ls-remote', 'origin', 'refs/heads/main', cwd=source).split()
    require(len(remote) == 2 and remote[0] == commit, 'Source SHA is not published on origin/main')
    require(not args.output.exists(), 'Output directory already exists; use a fresh bundle')
    images = []
    roles = set()
    for item in args.image:
        role, separator, reference = item.partition('=')
        require(separator and re.fullmatch(r'UVH_[A-Z_]+_IMAGE', role) and role not in roles,
                'Use unique UVH_*_IMAGE=image arguments')
        roles.add(role)
        image = inspect(reference)
        if role in {'UVH_API_IMAGE', 'UVH_WEB_IMAGE', 'UVH_CADDY_IMAGE',
                    'UVH_POSTGRES_IMAGE', 'UVH_BACKUP_IMAGE'}:
            revision = (image['Config'].get('Labels') or {}).get('org.opencontainers.image.revision')
            require(revision == commit, 'Built images must carry the published source revision label')
        images.append({'role': role, 'id': image['Id'], 'reference': reference,
                       'repoDigests': image.get('RepoDigests') or [], 'platform': 'linux/amd64'})
    require(images, 'At least one image is required')
    args.output.mkdir(parents=True, mode=0o700)
    for entry in images:
        entry['file'] = entry['id'][7:] + '.tar'
        file = args.output / entry['file']
        if not file.exists():
            subprocess.run(['docker', 'image', 'save', '--platform', 'linux/amd64', '--output', str(file), entry['reference']], check=True)
            archive_id(file, entry['id'])
            require(inspect(entry['reference'])['Id'] == entry['id'], 'Image changed during export')
        entry['bytes'] = file.stat().st_size
        entry['sha256'] = digest(file)
    manifest = args.output / 'manifest.json'
    manifest.write_text(json.dumps({'schema': 'uvh-image-bundle/1', 'sourceCommit': commit,
                                   'validationStatus': 'pending', 'images': images}, indent=2) + '\n')
    print('Source SHA:', commit)
    print('Manifest SHA-256:', digest(manifest))
    print('Bundle written; runtime, audit, SBOM and production acceptance gates still apply.')


def verify(args):
    manifest = args.bundle / 'manifest.json'
    require(re.fullmatch(r'[0-9a-f]{64}', args.manifest_sha256), 'Expected a full manifest hash')
    require(re.fullmatch(r'[0-9a-f]{40}', args.source_commit), 'Expected a full source SHA')
    require(not manifest.is_symlink(), 'Manifest must not be a symlink')
    require(digest(manifest) == args.manifest_sha256, 'Manifest SHA-256 mismatch')
    document = json.loads(manifest.read_text())
    require(document.get('schema') == 'uvh-image-bundle/1', 'Unsupported bundle schema')
    require(document.get('sourceCommit') == args.source_commit, 'Source SHA mismatch')
    images = document.get('images')
    require(isinstance(images, list) and images, 'Missing image entries')
    roles = set()
    # Validate the entire batch before loading the first image.
    for entry in images:
        role = entry.get('role', '')
        image_id = entry.get('id', '')
        require(re.fullmatch(r'UVH_[A-Z_]+_IMAGE', role) and role not in roles, 'Invalid or duplicate role')
        roles.add(role)
        require(re.fullmatch(r'sha256:[0-9a-f]{64}', image_id), 'Invalid image ID')
        require(entry.get('platform') == 'linux/amd64', 'Wrong declared platform')
        require(entry.get('file') == image_id[7:] + '.tar', 'Unexpected archive filename')
        require(re.fullmatch(r'[0-9a-f]{64}', entry.get('sha256', '')), 'Invalid archive hash')
        file = args.bundle / entry['file']
        require(file.is_file() and not file.is_symlink(), 'Archive must be a regular file')
        require(file.stat().st_size == entry.get('bytes'), 'Archive size mismatch')
        require(digest(file) == entry['sha256'], 'Archive SHA-256 mismatch')
        archive_id(file, image_id)
    if args.action == 'import':
        require(not args.env_output.exists(), 'Image env output already exists')
        loaded = set()
        for entry in images:
            if entry['id'] not in loaded:
                subprocess.run(['docker', 'image', 'load', '--input', str(args.bundle / entry['file'])], check=True)
                loaded.add(entry['id'])
            require(inspect(entry['id'])['Id'] == entry['id'], 'Imported image ID mismatch')
        # Exclusive creation only after every import/inspection succeeds.
        fd = os.open(args.env_output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write('\n'.join(e['role'] + '=' + e['id'] for e in images) + '\n')
    print('PASS: manifest, source SHA, all archive hashes, image configuration IDs and platforms')
    print('No services started. This integrity result does not approve production promotion.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    out = sub.add_parser('export')
    out.add_argument('--source', type=Path, default=Path('.'))
    out.add_argument('--output', type=Path, required=True)
    out.add_argument('--image', action='append', required=True)
    for action in ('verify', 'import'):
        check = sub.add_parser(action)
        check.add_argument('--bundle', type=Path, required=True)
        check.add_argument('--manifest-sha256', required=True)
        check.add_argument('--source-commit', required=True)
        if action == 'import':
            check.add_argument('--env-output', type=Path, required=True)
    args = parser.parse_args()
    try:
        export(args) if args.action == 'export' else verify(args)
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError, tarfile.TarError) as error:
        print('Bundle rejected:', error, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
