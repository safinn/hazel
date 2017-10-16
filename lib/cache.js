// Packages
const fetch = require('node-fetch')
const convertStream = require('stream-to-string')

// Utilities
const checkPlatform = require('./platform')

const latest = {}
const { ACCOUNT, REPOSITORY, PRE, ONLY_PRE } = process.env

if (!ACCOUNT || !REPOSITORY) {
  console.error('Neither ACCOUNT, nor REPOSITORY are defined')
  process.exit(1)
}

const cacheReleaseList = async url => {
  const { status, body } = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github.preview'
    }
  })

  if (status !== 200) {
    return
  }

  let content = await convertStream(body)
  const matches = content.match(/[^ ]*\.nupkg/gim)

  if (matches.length === 0) {
    console.error('Tried to cache RELEASES, but failed')
    return
  }

  const nuPKG = url.replace('RELEASES', matches[0])
  content = content.replace(matches[0], nuPKG)

  if (!latest.files) {
    latest.files = {}
  }

  latest.files.RELEASES = content
}

const compareReleases = (stableRelease, preRelease) => {
  const stableVersion = new Date(stableRelease.published_at)
  const preReleaseVersion = new Date(preRelease.published_at)

  return stableVersion >= preReleaseVersion ? stableRelease : preRelease
}

const checkReleases = (...releases) => {
  return releases.filter(release => {
    return release && release.assets && Array.isArray(release.assets)
  })
}

const cacheRelease = async release => {
  if (!release || !release.assets || !Array.isArray(release.assets)) {
    return
  }

  const { tag_name } = release

  if (latest.version === tag_name) {
    console.log('Cached version is the same as latest')
    return
  }

  console.log(`Caching version ${tag_name}...`)

  latest.version = tag_name
  latest.notes = release.body
  latest.pub_date = release.published_at

  // Clear list of download links
  latest.platforms = {}

  for (const asset of release.assets) {
    const { name, browser_download_url } = asset

    if (name === 'RELEASES') {
      await cacheReleaseList(browser_download_url)
      continue
    }

    const platform = checkPlatform(name)

    if (!platform) {
      continue
    }

    latest.platforms[platform] = browser_download_url
  }

  console.log(`Finished caching version ${tag_name}`)
}

exports.refreshCache = async () => {
  const repo = ACCOUNT + '/' + REPOSITORY
  const url = `https://api.github.com/repos/${repo}/releases?per_page=100`

  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github.preview'
    }
  })

  if (response.status !== 200) {
    return
  }

  const data = await response.json()

  if (!Array.isArray(data) || data.length === 0) {
    return
  }

  // If we want to include pre-releases
  if (PRE) {
    // Find latest pre-release
    const preRelease = data.find(item => {
      return !item.draft && item.prerelease
    })

    // If ONLY_PRE enviroment variable is true, cache the pre-release
    if (ONLY_PRE) {
      return cacheRelease(preRelease)
    }

    // Find latest stable release
    const stableRelease = data.find(item => {
      return !item.draft && !item.prerelease
    })

    // Get array of legit releases (latest stable and latest pre-release)
    const releases = checkReleases(stableRelease, preRelease)

    switch (releases.length) {
      case 1:
        cacheRelease(releases[0])
        return
      case 2: {
        const latestRelease = compareReleases(stableRelease, preRelease)
        cacheRelease(latestRelease)
        return
      }
      default:
        return
    }
  }

  const release = data.find(item => {
    return !item.draft && !item.prerelease
  })

  cacheRelease(release)
}

// This is a method returning the cache
// because the cache would otherwise be loaded
// only once when the index file is parsed
exports.loadCache = () => latest
