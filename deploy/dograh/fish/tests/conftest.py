"""Make the flat kit modules importable the same way they are in the container.

The kit is bind-mounted flat into the Dograh api container (see README), so the
modules import each other by bare name (``import fish_config``). Tests add the
kit directory to ``sys.path`` to reproduce that exactly.
"""

import os
import sys

KIT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if KIT_DIR not in sys.path:
    sys.path.insert(0, KIT_DIR)
