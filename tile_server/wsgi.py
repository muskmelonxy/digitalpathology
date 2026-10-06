"""Gunicorn entrypoint: ``gunicorn -w 1 --threads 4 tile_server.wsgi:app``."""

from tile_server.app import create_app

app = create_app()
