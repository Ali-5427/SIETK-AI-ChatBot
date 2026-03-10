import { SIETK_KNOWLEDGE_BASE } from './sietk_knowledge_base';
import { FACULTY_DATA } from './faculty_data';
import { CURRICULUM_DATA } from './curriculum_data';

// A type guard to check if a key exists in an object
function isValidKey<T extends object>(obj: T, key: string | number | symbol): key is keyof T {
  return key in obj;
}

// Helper function to correctly format the output of findData
function processFindDataResult(result: any): string | null {
    if (!result) {
        return null;
    }
    if (typeof result === 'string') {
        return result;
    }
    return JSON.stringify(result, null, 2);
}

// Main function to search the entire knowledge base
export function searchKnowledgeBase(query: string, department?: string, category?: string): string | null {
  const lowerQuery = query.toLowerCase();

  // Category-based search for higher precision
  if (category) {
    switch (category) {
      case 'faculty':
        return searchFaculty(lowerQuery, department);
      case 'curriculum':
      case 'syllabus':
        return searchCurriculum(lowerQuery, department);
      case 'fees':
        // Fee information is spread out, so we search the whole knowledge base
        return processFindDataResult(findData(SIETK_KNOWLEDGE_BASE, lowerQuery));
      case 'admissions':
        return processFindDataResult(findData(SIETK_KNOWLEDGE_BASE.admissions, lowerQuery));
      case 'placements':
        return processFindDataResult(findData(SIETK_KNOWLEDGE_BASE.placements_and_training, lowerQuery));
      case 'contact':
        return processFindDataResult(findData(SIETK_KNOWLEDGE_BASE.college_overview, lowerQuery));
    }
  }

  // General keyword-based search if no category is provided
  if (lowerQuery.includes('hod') || lowerQuery.includes('head of department')) {
    return searchFaculty(lowerQuery, department);
  }
  if (lowerQuery.includes('curriculum') || lowerQuery.includes('syllabus') || lowerQuery.includes('subjects')) {
    return searchCurriculum(lowerQuery, department);
  }
  if (lowerQuery.includes('fee') || lowerQuery.includes('scholarship')) {
    return processFindDataResult(findData(SIETK_KNOWLEDGE_BASE, lowerQuery));
  }
  if (lowerQuery.includes('admission') || lowerQuery.includes('intake')) {
    return JSON.stringify(SIETK_KNOWLEDGE_BASE.admissions, null, 2);
  }
   if (lowerQuery.includes('placement') || lowerQuery.includes('recruiter')) {
    return JSON.stringify(SIETK_KNOWLEDGE_BASE.placements_and_training, null, 2);
  }

  // Fallback to a general search across the main knowledge base
  const result = findData(SIETK_KNOWLEDGE_BASE, lowerQuery);
  return processFindDataResult(result);
}

// Specialized function to search faculty data
function searchFaculty(query: string, department?: string): string | null {
  const deptKey = department?.toLowerCase().replace(/\s+/g, '_');

  if (deptKey && isValidKey(FACULTY_DATA, deptKey)) {
    const deptData = FACULTY_DATA[deptKey];
    if (query.includes('hod')) {
      return JSON.stringify({ [deptKey]: { hod: deptData.hod } }, null, 2);
    }
    return JSON.stringify({ [deptKey]: deptData }, null, 2);
  }

  // If no specific department, search for HODs across all departments
  if (query.includes('hod')) {
      const allHODs = Object.keys(FACULTY_DATA).reduce((acc, key) => {
          if (isValidKey(FACULTY_DATA, key)) {
              acc[key] = FACULTY_DATA[key].hod;
          }
          return acc;
      }, {} as { [key: string]: any });
      return JSON.stringify(allHODs, null, 2);
  }
  
  // Return all faculty data if no department is specified
  return JSON.stringify(FACULTY_DATA, null, 2);
}

// Specialized function to search curriculum data
function searchCurriculum(query: string, department?: string): string | null {
  const deptKey = department?.toLowerCase().replace(/\s+/g, '_');

  if (deptKey && isValidKey(CURRICULUM_DATA, deptKey)) {
    const deptCurriculum = CURRICULUM_DATA[deptKey];
    // Further filtering can be added here (e.g., for year/semester)
    return JSON.stringify({ [deptKey]: deptCurriculum }, null, 2);
  }
  
  // Return all curriculum data if no department is specified
  return JSON.stringify(CURRICULUM_DATA, null, 2);
}

// Recursive helper function to find data within any object
function findData(data: any, query: string): any | null {
  if (typeof data === 'string' && data.toLowerCase().includes(query)) {
    return data;
  }
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  for (const key in data) {
    if (key.toLowerCase().includes(query)) {
      return data; // Return the whole object if the key matches
    }
    const nestedResult = findData(data[key], query);
    if (nestedResult) {
      return nestedResult;
    }
  }

  return null;
}
