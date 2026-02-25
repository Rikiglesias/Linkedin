param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CliArgs
)

npx ts-node src/index.ts @CliArgs
