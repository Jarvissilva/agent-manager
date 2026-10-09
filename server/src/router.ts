import { Router } from 'express';
import createProject from './controllers/project/createProject.js';
import getProjects from './controllers/project/getProjects.js';
import selectDirectory from './controllers/project/selectDirectory.js';

const router = Router();

router.get('/projects', getProjects);
router.post('/projects', createProject);
router.post('/projects/select-directory', selectDirectory);

export default router;
