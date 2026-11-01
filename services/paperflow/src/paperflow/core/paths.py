from __future__ import annotations

import os
from pathlib import Path


# 返回可配置的持久化数据目录，未指定时沿用用户目录下的 .paperflow
def data_dir() -> Path:
    configured = os.environ.get("PAPERFLOW_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path.home() / ".paperflow"
