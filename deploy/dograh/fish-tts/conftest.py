def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "requires_container: only does real work inside dograh-api-1 "
        "(needs pipecat + the mounted registry); skips elsewhere.",
    )
