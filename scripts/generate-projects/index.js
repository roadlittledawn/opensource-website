
/*
 * 
 * Purpose:
 * A script to generate the necessary Github repository (project/project-stats) data files for the opensource.newrelic.com
 * Github provides 2 different API's for accessing this information, their REST-based API and their newer GraphQL API
 * 
 * Resources:
 * - https://octokit.github.io/rest.js/v17
 * - https://developer.github.com/v4/
 * - https://github.com/octokit/graphql.js
 * 
 */

const path = require('path');
const fs = require('fs');
const {
  organizationRepositoryIterator,
  fetchStats,
  fetchRepo
} = require('./fetch');
const { SCREENSHOT_FOLDERS, ORG_REPOS } = require('./constants');

const prettyPrintJson = (json) => console.log(JSON.stringify(json, null, 2));
const prettyPrint = (message) => console.log(message);
const sleep = (delay) => {
  return new Promise(resolve => {
    setTimeout(resolve, delay)
  });
}

/*
 * 1. Create a personal access token with the following scopes:
    user - Just read:user
    public_repo - Yes
    repo
    repo_deployment
    repo:status - Yes
    read:repo_hook
    read:org
    read:public_key
    read:gpg_key
  2. Run the script like `GH_TOKEN=<your token> npm start`
 */

const OVERWRITE_EXISTING = true;

function formatRepositories(repositories) {
  // prettyPrintJson(Object.keys(response.data));
  // const { status, url, headers, data: repositories } = response;
  const humanize = (slug) => slug.replace('-', ' ');
  return repositories.map(r => {
    return {
      "name": r.name,
      "fullName": r.full_name,
      "owner": {
        "login": r.owner.login,
        "type": r.owner.type,
      },
      "title": humanize(r.name),
      "supportUrl": "https://discuss.newrelic.com/", // TO DO
      "githubUrl": r.html_url,
      "permalink": "https://opensource.newrelic.com/projects/" + r.full_name,
      "iconUrl": r.html_url + "/blob/master/icon.png?raw=true", // TO DO - Can we rely on this?
      "shortDescription": "", // TO DO
      "description": r.description,
      // "screenshots": [ "https://github.com/newrelic/nr1-workload-geoops/blob/master/assets/documentation-images/detail-panel-legend.png?raw=true", "https://github.com/newrelic/nr1-workload-geoops/blob/master/assets/documentation-images/file-upload.png?raw=true" ],
      "ossCategory": {
        "title": "Lorem Ipsum",
        "slug": "lorem-ipsum"
      }, // TO DO
      "projectType": {
        "title": "New Relic One App",
        "slug": "nr1-app"
      }, // TO DO
      "primaryLanguage": r.language,
      "tags": [
        "point-of-sale",
        "maps",
        "infrastructure"
      ], // TO DO
      "website": {
        "title": humanize(r.name), // TO DO - Can/should be different
        "url": r.html_url // TO DO - this won't always be the Github repo url?
      },
      "version": "0.1.0"
    }
  })
}

function formatStats (project, stats) {
  const { repoStats, contributorStats } = stats;
  const contributorCount = contributorStats.length;


  const screenshots = Object.entries(SCREENSHOT_FOLDERS).reduce((p, [ key, path ]) => {
    const fileNames = repoStats[key];

    if (!fileNames || fileNames === null) {
      return p;
    }

    // prettyPrintJson(fileNames);
    // TO DO filter out .gitkeep

    if(Array.isArray(fileNames.entries)) {

      const fullPaths = fileNames.entries.map((file) => {
        const dir = path.replace(':', '/'); // Replace "master:" with "master/"
        const suffix = "?raw=true";
        // const url = `https://github.com/` + project.fullName + `/blob/` + dir + file.name + suffix;
        const url = `https://raw.githubusercontent.com/` + project.fullName + `/` + dir + file.name;
        return url;
      });
      return p.concat(fullPaths);
    }
    return p;
  }, []);

  return {
    "projectFullName": project.fullName,
    "issues": {
      "open": repoStats.issues.totalCount // Filtering by a status of OPEN
    },
    "releases": repoStats.releases.totalCount, // TO DO
    "commits": repoStats.defaultBranchRef.target.history.totalCount,
    "contributors": contributorCount,
    "pullRequests": {
      "open": repoStats.pullRequests.totalCount // Filtering by a status of OPEN
    },
    "searchCategory": "good first issue", // TO DO - Use this to go get cachedIssues? We should move this onto the project object
    "cachedIssues": repoStats.issues.nodes.map(node => ({
      ...node,
      createdBy: node.author.name || node.author.login || 'Unknown'
    })), // Note: createdBy is author.login
    "cachedContributors": contributorStats.map(i => ({
      id: i.author.id,
      login: i.author.login,
      avatarUrl: i.author.avatar_url,
      htmlUrl: i.author.html_url,
      contributions: i.total
    })),
    "languages": repoStats.languages.nodes,
    "screenshots": screenshots
  }
}

function writeProjectsToGatsby(projects) {
  projects.forEach((project) => {
    const fileName = project.fullName.replace('/', '-') + '.json';
    const outputDir = path.resolve(__dirname, '../../src/data/projects');
    const outputPath = outputDir + '/' + fileName; 
    const exists = fs.existsSync(outputPath);
    const jsonContent = JSON.stringify(project, null, 2);
    
    // prettyPrint('Writing ' + fileName);

    if (OVERWRITE_EXISTING || !exists) {
      fs.writeFileSync(outputPath, jsonContent);
    }
  })
}

async function calculateAndWriteProjectStats(project) {
  const owner = project.owner.login;
  const repo = project.name;

  // prettyPrint('Fetching stats for ' + project.fullName);

  const stats = await fetchStats(owner, repo);
  writeProjectStatsToGatsby(project, formatStats(project, stats));
}

function writeProjectStatsToGatsby(project, projectStats) {
  const fileName = project.fullName.replace('/', '-');
  const outputDir = path.resolve(__dirname, '../../src/data/project-stats');
  const outputPath = outputDir + '/' + fileName + '.json'; 
  const exists = fs.existsSync(outputPath);
  const jsonContent = JSON.stringify(projectStats, null, 2);
  
  if (OVERWRITE_EXISTING || !exists) {
    fs.writeFileSync(outputPath, jsonContent);
  }
}

/*
 * Generates files with a filename like:
 * projects/<organization>-<repository-name>.json
 */
async function generateProjects ({ iteratorOptions }) {
  const delay = 2000;

  if (iteratorOptions.repo) {
    const response = await fetchRepo({
      options: iteratorOptions
    });

    processProjects(response)
    await sleep(delay);
    return;
  }

  const iterator = organizationRepositoryIterator(iteratorOptions)();
  let result = iterator.next();
  const response = await result.value;
  processProjects(response);

  while(!result.done) {
    result = await iterator.next();
    const response = await result.value;
    processProjects(response);
    await sleep(delay);
  }
}

function processProjects (response) {
  const { status, url, headers, data } = response;
  const dataAsArray = Array.isArray(data) ? data : [data];
  const filteredRepos = dataAsArray.filter(r => r && !r.archived);

  prettyPrint('After removing Archived repositories found ' + filteredRepos.length + ' results:');
  prettyPrint(filteredRepos.map(d => 'id: ' + d.id + " " + d.full_name).join('\n'));

  writeProjectsToGatsby(formatRepositories(filteredRepos));
}

/*
 * Generates files with a filename like:
 * project-stats/<organization>-<repository-name>.json
 */
async function generateProjectStats ({ iteratorOptions }) {
  if (iteratorOptions.repo) {
    const response = await fetchRepo({
      options: iteratorOptions
    });
    prettyPrintJson(response);
    processProjectStats(response)
    return;
  }

  const iterator = organizationRepositoryIterator(iteratorOptions)();  
  const delay = 2000;

  let result = iterator.next();
  const response = await result.value;
  processProjectStats(response);

  while(!result.done) {
    result = await iterator.next();

    const response = await result.value;
    processProjectStats(response);
    await sleep(delay);
  }
}

async function processProjectStats (response) {
  const { status, url, headers, data } = response;
  const dataAsArray = Array.isArray(data) ? data : [data];
  const filteredRepos = dataAsArray.filter(r => r && !r.archived);

  prettyPrint('After removing Archived repositories found ' + filteredRepos.length + ' results:');
  prettyPrint(filteredRepos.map(d => 'id: ' + d.id + " " + d.full_name).join('\n'));

  const repositories = formatRepositories(filteredRepos);
  for (const repository of repositories) {
    calculateAndWriteProjectStats(repository);
    await sleep(2000);
  }
}

/*
 RequestError [HttpError]: You have triggered an abuse detection mechanism. Please wait a few minutes before you try again.
*/
async function start () {
  const defaultOptions = { pages: 0, start_page: 1, per_page: 100 };

  for ( const { org, repo = false } of ORG_REPOS ) {
    await generateProjects({
      iteratorOptions: {
        ...defaultOptions,
        org,
        repo
      }
    });
    await sleep(2000);
  }

  for ( const { org, repo = false } of ORG_REPOS ) {
    await generateProjectStats({
      iteratorOptions: {
        ...defaultOptions,
        org,
        repo
      }
    });
    await sleep(2000);
  }
}


(async function () {
  start()
})();