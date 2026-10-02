"""Export verified interface bundles to searchable textures and NGUI sprites.

Requires UnityPy and Pillow. Game-content resource families are excluded by the
download manifest. Personal accounts, chats and application settings are unused.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path


def export_library(root, dependency_path=None):
    if dependency_path:
        sys.path.insert(0, str(dependency_path))
    import UnityPy

    root = root.resolve()
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('failed'):
        raise ValueError('Finish downloading all interface bundles first.')
    paths = []
    source_names = {}
    for resource in manifest['resources']:
        file = (root / 'bundles' / resource['path']).resolve()
        if not file.is_relative_to(root / 'bundles'):
            raise ValueError('Invalid bundle path.')
        if hashlib.sha256(file.read_bytes()).hexdigest() != resource['sha256']:
            raise ValueError('Bundle checksum failed: ' + resource['path'])
        paths.append(str(file))
        source_names[file.name] = resource['path']
    env = UnityPy.load(*paths)
    sources = {}

    def register(file, source):
        sources[id(file)] = source
        for child in (getattr(file, 'files', None) or {}).values():
            register(child, source)

    for name, file in env.files.items():
        register(file, source_names.get(Path(name).name, name))

    out = root / 'exported'
    out.mkdir(exist_ok=True)
    records, errors, atlases, textures, dynamic_textures = [], [], [], {}, []
    content_names = re.compile(r'^(?:BG_|CH\d)|(?:LobbyIllust|Portrait|ScenarioImage|MovieCG|Banner)', re.I)

    def safe_name(name):
        return re.sub(r'[^\w.-]', '_', name)[:140] or 'unnamed'

    def save_image(image, folder, name, obj, source, metadata=None):
        namespace = hashlib.sha256(source.encode('utf-8')).hexdigest()[:12]
        destination = out / folder / namespace / (safe_name(name) + '__' + str(obj.path_id) + '.png')
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination)
        record = dict(name=name, type=folder, file=destination.relative_to(root).as_posix(),
                      bundle=source, pathId=str(obj.path_id), size=list(image.size),
                      sha256=hashlib.sha256(destination.read_bytes()).hexdigest())
        if metadata:
            record.update(metadata)
        records.append(record)
        return record

    for obj in env.objects:
        source = sources.get(id(obj.assets_file), obj.assets_file.name)
        try:
            if obj.type.name == 'MonoBehaviour':
                try:
                    atlas = obj.read_typetree()
                except Exception:
                    continue  # Other game scripts need type trees not required for image export.
                if isinstance(atlas.get('mSprites'), list) and atlas.get('m_Name'):
                    atlases.append((obj, source, atlas))
            elif obj.type.name in ('Texture2D', 'Sprite'):
                data = obj.read()
                name = data.m_Name
                if content_names.search(name):
                    continue
                if obj.type.name == 'Texture2D':
                    stream = data.m_StreamData
                    if (name == 'Font Texture' and data.m_Width == 0 and data.m_Height == 0
                            and not data.image_data and (not stream or (not stream.path and not stream.size))):
                        dynamic_textures.append(dict(name=name, bundle=source, pathId=str(obj.path_id),
                                                     reason='Empty dynamic font atlas; pixels are generated at runtime.'))
                        continue
                image = data.image
                save_image(image, obj.type.name, name, obj, source)
                if obj.type.name == 'Texture2D':
                    textures.setdefault(name, []).append((source, image))
        except Exception as error:
            errors.append(dict(bundle=source, pathId=str(obj.path_id), type=obj.type.name,
                               error=str(error)[:200]))

    atlas_metadata = []
    for obj, source, atlas in atlases:
        name = atlas['m_Name']
        candidates = textures.get(name, [])
        if not candidates:
            errors.append(dict(bundle=source, type='NGUI', name=name, error='Atlas texture unavailable'))
            continue
        image = next((picture for owner, picture in candidates if owner == source), candidates[0][1])
        atlas_metadata.append(dict(name=name, bundle=source, pathId=str(obj.path_id), sprites=atlas['mSprites']))
        for sprite in atlas['mSprites']:
            if content_names.search(sprite['name']):
                continue
            x, y, width, height = (int(sprite[key]) for key in ('x', 'y', 'width', 'height'))
            if width <= 0 or height <= 0 or x < 0 or y < 0 or x + width > image.width or y + height > image.height:
                errors.append(dict(bundle=source, type='NGUI', name=sprite['name'], error='Invalid atlas rectangle'))
                continue
            crop = image.crop((x, y, x + width, y + height))
            # Sprite name is unique inside its atlas; retain full crop/border metadata.
            save_image(crop, 'NGUI', name + '__' + sprite['name'], obj, source, dict(atlas=name, sprite=sprite))

    index = dict(schemaVersion=1, gameVersion=manifest['gameVersion'],
                 images=records, atlases=atlas_metadata, dynamicTextures=dynamic_textures, errors=errors)
    (root / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Exported ' + str(len(records)) + ' interface images from ' + str(len(atlas_metadata))
          + ' atlases; dynamic font placeholders: ' + str(len(dynamic_textures)) + '; errors: ' + str(len(errors)))
    if errors:
        raise ValueError('Some interface images need review; see index.json.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent / 'resources/blue-archive/ui-library/1.93.454564')
    parser.add_argument('--dependencies', type=Path)
    options = parser.parse_args()
    export_library(options.root, options.dependencies)
