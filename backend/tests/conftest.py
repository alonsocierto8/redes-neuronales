import os
import tempfile


_test_data_dir = tempfile.TemporaryDirectory(prefix="neurolab-test-data-")
os.environ["NEUROLAB_DATA_DIR"] = _test_data_dir.name
