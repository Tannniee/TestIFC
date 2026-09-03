"""Run the real desktop composition with isolated settings and an owned stop file."""
import multiprocessing
from pathlib import Path
import sys
from time import sleep

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "desktop"))


def main():
    import main as desktop_main
    stop_file, data_dir = map(Path, sys.argv[1:3])
    desktop_main.user_data_dir = lambda: data_dir
    original_start = desktop_main.webview.start
    original_create = desktop_main.webview.create_window

    def wait_stop():
        while not stop_file.exists():
            sleep(0.1)
        desktop_main.webview.windows[0].destroy()

    def start(**kwargs):
        original_start(wait_stop, **kwargs)

    def create(*args, **kwargs):
        return original_create(*args, **kwargs, hidden=True)

    desktop_main.webview.start = start
    desktop_main.webview.create_window = create
    desktop_main.main()


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
