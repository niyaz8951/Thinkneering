$AccountId = "9dc9277c30ffbc8837d2892a8e97dd23"
$ProjectName = "thinkneering"
$ApiToken = Read-Host "Enter Cloudflare API Token"

$Headers = @{
    Authorization = "Bearer $ApiToken"
}

Get-Content ".\deployments.txt" | ForEach-Object {

    $DeploymentId = $_.Trim()

    if ($DeploymentId -ne "") {

        $Uri = "https://api.cloudflare.com/client/v4/accounts/$AccountId/pages/projects/$ProjectName/deployments/$DeploymentId"

        Write-Host "Deleting $DeploymentId ..." -ForegroundColor Yellow

        try {
            Invoke-RestMethod `
                -Method Delete `
                -Uri $Uri `
                -Headers $Headers

            Write-Host "Deleted $DeploymentId" -ForegroundColor Green
        }
        catch {
            Write-Host "Failed $DeploymentId" -ForegroundColor Red
            Write-Host $_.Exception.Message
        }
    }
}

Write-Host "Finished." -ForegroundColor Cyan