import os
from helpers.math import double as twice


class Runner:
    def calculate(self, value):
        return twice(value)


async def workspace_name():
    return os.getcwd()
