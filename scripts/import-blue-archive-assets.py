"""Install the pinned BA artwork as a local-only, offline theme pack.

Requires Pillow and UnityPy. No client executable, account or chat data is used.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.request


ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'public' / 'img' / 'blue-archive'


def digest(data, algorithm='sha256'):
    return hashlib.new(algorithm, data).hexdigest()


def download(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read()


def install(bundle_path=None, originals=None):
    from PIL import Image, ImageChops, ImageOps
    import UnityPy

    manifest = json.loads((ASSETS / 'sources.json').read_text(encoding='utf-8'))
    target = ASSETS / 'local'
    target.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='ba-theme-', dir=ROOT / 'Cache') as directory:
        stage = Path(directory)
        bundle = Path(bundle_path).read_bytes() if bundle_path else download(manifest['bundle']['url'])
        if digest(bundle) != manifest['bundle']['sha256']:
            raise ValueError('The downloaded bundle does not match the pinned artwork version.')
        env = UnityPy.load(bundle)
        textures, atlases = {}, {}
        for obj in env.objects:
            if obj.type.name == 'Texture2D':
                data = obj.read()
                if data.m_Name in ('Common', 'Emoji'):
                    textures[data.m_Name] = data.image
            elif obj.type.name == 'MonoBehaviour':
                data = obj.read_typetree()
                if data.get('m_Name') in ('Common', 'Emoji') and 'mSprites' in data:
                    atlases[data['m_Name']] = {s['name']: s for s in data['mSprites']}
        # Validate the entire pack before replacing any installed files.
        for asset in manifest['assets']:
            file = asset['file']
            if Path(file).name != file:
                raise ValueError('Asset names must be plain file names.')
            destination = stage / file
            if asset['kind'] == 'game-sprite':
                sprite = atlases[asset['atlas']][asset['sprite']['name']]
                if sprite != asset['sprite']:
                    raise ValueError(f'Sprite metadata changed: {file}')
                x, y, w, h = (sprite[key] for key in ('x', 'y', 'width', 'height'))
                textures[asset['atlas']].crop((x, y, x+w, y+h)).save(destination)
            elif asset['kind'] == 'game-background':
                data = (Path(originals) / file).read_bytes() if originals else download(asset['url'])
                if digest(data, 'md5') != asset['md5']:
                    raise ValueError(f'Background checksum mismatch: {file}')
                destination.write_bytes(data)
            elif asset['kind'] == 'adaptation':
                original = Image.open(stage / asset['source']).convert('RGBA')
                color = original.convert('RGB')
                if asset['operation'] == 'desaturate-tint-preserve-alpha':
                    color = ImageOps.grayscale(color).convert('RGB')
                elif asset['operation'] != 'multiply-rgb-preserve-alpha':
                    raise ValueError(f'Unknown adaptation operation: {file}')
                rgb = ImageChops.multiply(color, Image.new('RGB', original.size, asset['tint']))
                rgb.putalpha(original.getchannel('A'))
                rgb.save(destination)
            else:
                raise ValueError(f'Unknown asset kind: {file}')
            if asset.get('sha256') and digest(destination.read_bytes()) != asset['sha256']:
                raise ValueError(f'Artwork checksum mismatch: {file}')
            with Image.open(destination) as image:
                image.verify()
        installed = {
            **manifest,
            'assets': [{**asset, 'sha256': digest((stage / asset['file']).read_bytes())} for asset in manifest['assets']],
        }
        (stage / 'installed.json').write_text(json.dumps(installed, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
        for file in stage.iterdir():
            os.replace(file, target / file.name)
    print(f'Installed {len(installed["assets"])} local BA theme images into {target}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', help='Use an already downloaded pinned bundle (checksum verified).')
    parser.add_argument('--originals', help='Use already downloaded backgrounds (checksum verified).')
    args = parser.parse_args()
    (ROOT / 'Cache').mkdir(exist_ok=True)
    install(args.bundle, args.originals)
