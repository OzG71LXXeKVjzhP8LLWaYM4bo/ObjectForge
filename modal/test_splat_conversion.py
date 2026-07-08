from __future__ import annotations

import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path


class _FakeImage:
    @classmethod
    def debian_slim(cls, python_version: str):
        return cls()

    @classmethod
    def from_registry(cls, *args: str, **kwargs: str):
        return cls()

    def env(self, *args: object, **kwargs: object):
        return self

    def apt_install(self, *args: str):
        return self

    def pip_install(self, *args: str):
        return self

    def run_commands(self, *args: str):
        return self


class _FakeVolume:
    @classmethod
    def from_name(cls, name: str, create_if_missing: bool = False):
        return cls()


class _FakeApp:
    def __init__(self, name: str):
        self.name = name

    def function(self, **kwargs):
        return lambda func: func


def _install_fake_modal() -> None:
    fake_modal = types.SimpleNamespace(
        App=_FakeApp,
        Image=_FakeImage,
        Volume=_FakeVolume,
        fastapi_endpoint=lambda **kwargs: (lambda func: func),
    )
    sys.modules["modal"] = fake_modal


def _load_modal_app():
    _install_fake_modal()
    path = Path(__file__).with_name("modal_app.py")
    spec = importlib.util.spec_from_file_location("modal_app_for_test", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load modal_app.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class SplatConversionTest(unittest.TestCase):
    def test_convert_gaussian_ply_to_splat_writes_32_byte_rows(self) -> None:
        modal_app = _load_modal_app()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ply_path = root / "gaussian.ply"
            splat_path = root / "room_splat.splat"
            ply_path.write_text(
                "\n".join(
                    [
                        "ply",
                        "format ascii 1.0",
                        "element vertex 2",
                        "property float x",
                        "property float y",
                        "property float z",
                        "property float f_dc_0",
                        "property float f_dc_1",
                        "property float f_dc_2",
                        "property float opacity",
                        "property float scale_0",
                        "property float scale_1",
                        "property float scale_2",
                        "property float rot_0",
                        "property float rot_1",
                        "property float rot_2",
                        "property float rot_3",
                        "end_header",
                        "0 1 2 0 0 0 2 -2 -2 -2 1 0 0 0",
                        "3 4 5 0.5 0.25 -0.25 -2 -3 -3 -3 0 1 0 0",
                    ]
                ),
                encoding="utf-8",
            )

            modal_app.convert_gaussian_ply_to_splat(ply_path, splat_path)

            data = splat_path.read_bytes()
            self.assertEqual(len(data), 64)
            self.assertGreater(data[27], data[59])


if __name__ == "__main__":
    unittest.main()
